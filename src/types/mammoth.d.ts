declare module "mammoth/mammoth.browser" {
  function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{
    value: string;
    messages: unknown[];
  }>;
  const mammoth: { convertToHtml: typeof convertToHtml };
  export default mammoth;
}
