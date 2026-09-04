async function virusScan(file) {
  // virus scan
}

async function ocrProcessing(file) {
  // ocr processing
}

async function ner(extractedText) {
  // ner
}

async function autoTagging(extractedText) {
  // auto-tagging
}


export function createDocumentProcessingProcessor(deps) {
  return async function processDocument(job) {
    const { versionId, documentId, caseId } = job.data;

    await virusScan();
    await ocrProcessing();
    await ner();
    await autoTagging();
  };
}
