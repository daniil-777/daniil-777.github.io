// Optional offline OCR for allowlisted public scans; uses Apple's installed Vision framework.
import Foundation
import AppKit
import PDFKit
import Vision

struct Page: Encodable { let number: Int; let text: String; let confidence: Float }
guard CommandLine.arguments.count == 2,
      let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
    fputs("Expected a readable public PDF.\n", stderr); exit(1)
}
var pages: [Page] = []
for index in 0..<document.pageCount {
    // The patent's cover contains inventor/contact metadata. Index technical pages only.
    if [0, 1, 31, 33, 35, 36].contains(index) { pages.append(Page(number: index + 1, text: "", confidence: 0)); continue }
    try autoreleasepool {
        guard let page = document.page(at: index) else { return }
        let bounds = page.bounds(for: .mediaBox), scale: CGFloat = 2
        let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
        var rect = CGRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { return }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = true
        request.usesCPUOnly = true
        try VNImageRequestHandler(cgImage: cgImage).perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first }.filter { $0.confidence >= 0.85 }
        let mean = lines.isEmpty ? 0 : lines.reduce(Float(0)) { $0 + $1.confidence } / Float(lines.count)
        pages.append(Page(number: index + 1, text: lines.map { $0.string }.joined(separator: "\n"), confidence: mean))
    }
}
let data = try JSONEncoder().encode(pages)
FileHandle.standardOutput.write(data)
