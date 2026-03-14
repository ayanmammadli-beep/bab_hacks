declare module "five-bells-condition" {
  class PreimageSha256 {
    setPreimage(preimage: Buffer): void;
    serializeBinary(): Buffer;
    getConditionBinary(): Buffer;
  }
  export { PreimageSha256 };
}
