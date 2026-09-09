/**
 * Runner do qpdf (C++ compilado pra WebAssembly — pacote @neslinesli93/qpdf-wasm).
 * É a ÚNICA peça do app capaz de DECIFRAR um PDF: pdf-lib não decifra nem com
 * a senha (validado na v1.3.2 — copyPages/save quebram em AES) e o pdf.js só
 * lê. O qpdf é o utilitário de referência pra isso (`qpdf --decrypt`).
 *
 * Este módulo NÃO importa o glue/wasm (isso fica em qpdf.ts, via `?url` do
 * Vite): recebe a factory e a URL do .wasm por injeção, então os testes em
 * Node criam o mesmo runner apontando pro arquivo em node_modules.
 *
 * Mecânica: o módulo Emscripten tem um sistema de arquivos em memória (MEMFS);
 * cada chamada grava as entradas, roda `callMain(argv)` (síncrono — o main do
 * qpdf; o runtime fica vivo entre chamadas, `noInitialRun`) e lê/apaga as
 * saídas. Códigos de saída do qpdf: 0 ok · 2 erro (ex.: "invalid password")
 * · 3 ok com avisos.
 *
 * stdout/stderr: ESTE build ignora `Module.print/printErr` — na inicialização
 * ele faz `console.log.bind(console)` / `console.error.bind(console)` e o TTY
 * do MEMFS escreve por essas referências. Por isso o runner troca console.log/
 * console.error por despachantes SÓ durante a inicialização do módulo (as
 * referências ficam presas neles) e restaura os originais em seguida: fora de
 * uma chamada os despachantes repassam pro console real; durante `callMain`
 * acumulam num buffer por chamada. Nada mais no app é afetado.
 */
// Só o que este build do Emscripten exporta no FS (sem analyzePath).
export interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  mkdir(path: string): void;
  rmdir(path: string): void;
  stat(path: string): unknown;
}

export interface QpdfModule {
  callMain(args: string[]): number;
  FS: QpdfFS;
}

export type QpdfFactory = (opts: {
  locateFile: (file: string) => string;
  noInitialRun?: boolean;
  print?: (line: string) => void;
  printErr?: (line: string) => void;
}) => Promise<QpdfModule>;

export interface QpdfRun {
  code: number;
  stdout: string;
  stderr: string;
  /** saídas pedidas: bytes ou null se o qpdf não gerou o arquivo */
  files: Record<string, Uint8Array | null>;
}

export interface QpdfRunner {
  /** argv sem o nome do programa; caminhos de `inputs`/`outputs` são relativos
   *  a um diretório de trabalho próprio da chamada (apagado ao fim). */
  run(args: string[], inputs: Record<string, Uint8Array>, outputs: string[]): QpdfRun;
}

export async function createQpdfRunner(
  factory: QpdfFactory,
  wasmUrl: string,
): Promise<QpdfRunner> {
  let out = "";
  let err = "";
  let capturing = false;
  const join = (args: unknown[]) => args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  const realLog = console.log;
  const realErr = console.error;
  const dispatchLog = (...args: unknown[]) => {
    if (capturing) out += `${join(args)}\n`;
    else realLog.apply(console, args);
  };
  const dispatchErr = (...args: unknown[]) => {
    if (capturing) err += `${join(args)}\n`;
    else realErr.apply(console, args);
  };
  console.log = dispatchLog;
  console.error = dispatchErr;
  let mod: QpdfModule;
  try {
    mod = await factory({
      locateFile: () => wasmUrl,
      noInitialRun: true,
      print: dispatchLog,
      printErr: dispatchErr,
    });
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
  let seq = 0;
  return {
    run(args, inputs, outputs) {
      const dir = `/job${++seq}`;
      mod.FS.mkdir(dir);
      const created: string[] = [];
      try {
        for (const [name, data] of Object.entries(inputs)) {
          mod.FS.writeFile(`${dir}/${name}`, data);
          created.push(name);
        }
        out = "";
        err = "";
        // caminhos absolutos no MEMFS no lugar dos relativos do chamador
        const argv = args.map((a) =>
          a in inputs || outputs.includes(a) ? `${dir}/${a}` : a,
        );
        let code: number;
        capturing = true;
        try {
          code = mod.callMain(argv);
        } catch (e) {
          // exceção não-ExitStatus do runtime (ex.: abort/OOM) → trata como erro
          code = 1;
          err += `${e instanceof Error ? e.message : String(e)}\n`;
        } finally {
          capturing = false;
        }
        const files: Record<string, Uint8Array | null> = {};
        for (const name of outputs) {
          const path = `${dir}/${name}`;
          let exists = true;
          try {
            mod.FS.stat(path); // lança ENOENT quando o qpdf não gerou a saída
          } catch {
            exists = false;
          }
          if (exists) {
            // cópia: o buffer do MEMFS é reaproveitado/apagado logo abaixo
            files[name] = mod.FS.readFile(path).slice();
            created.push(name);
          } else {
            files[name] = null;
          }
        }
        return { code, stdout: out, stderr: err, files };
      } finally {
        for (const name of new Set(created)) {
          try {
            mod.FS.unlink(`${dir}/${name}`);
          } catch {
            /* já não existe */
          }
        }
        try {
          mod.FS.rmdir(dir);
        } catch {
          /* diretório com sobras: sem impacto (memória volátil) */
        }
      }
    },
  };
}
