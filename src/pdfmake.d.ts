declare module "pdfmake/build/pdfmake" {
  const pdfMake: {
    addVirtualFileSystem(files: Record<string, string>): void;
    createPdf(document: Record<string, unknown>): { download(filename: string): Promise<void> };
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const fonts: Record<string, string>;
  export default fonts;
}
