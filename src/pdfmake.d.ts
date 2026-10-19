declare module "pdfmake/build/pdfmake" {
  type FontFamily = { normal: string; bold: string; italics: string; bolditalics: string };
  interface OutputDocument {
    download(filename?: string): Promise<void>;
    getBlob(): Promise<Blob>;
    getBase64(): Promise<string>;
    getBuffer(): Promise<Uint8Array>;
  }
  const pdfMake: {
    fonts: Record<string, FontFamily>;
    addVirtualFileSystem(files: Record<string, string>): void;
    addFonts(fonts: Record<string, FontFamily>): void;
    setFonts(fonts: Record<string, FontFamily>): void;
    createPdf(document: Record<string, unknown>, options?: Record<string, unknown>): OutputDocument;
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const fonts: Record<string, string>;
  export default fonts;
}
