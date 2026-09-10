// aes-js não traz tipos próprios. Só usamos AES-128-CBC sem padding.
declare module "aes-js" {
  interface CbcInstance {
    encrypt(data: Uint8Array): Uint8Array;
    decrypt(data: Uint8Array): Uint8Array;
  }
  interface CbcCtor {
    new (key: Uint8Array, iv: Uint8Array): CbcInstance;
  }
  const aesjs: { ModeOfOperation: { cbc: CbcCtor } };
  export default aesjs;
}
