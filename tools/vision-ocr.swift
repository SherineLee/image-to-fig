// macOS 原生 OCR（Vision 框架）→ JSON
// 用法：vision-ocr <图片路径> [语言，逗号分隔，默认 zh-Hans,en-US]
// 输出：{"width":..,"height":..,"blocks":[{"text","x","y","width","height","confidence"}]}
// 坐标为像素，原点在左上角（Vision 的归一化左下原点已在此转换）

import Foundation
import Vision
import CoreGraphics
import ImageIO

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: vision-ocr <image> [zh-Hans,en-US]\n".data(using: .utf8)!)
  exit(2)
}
let path = args[1]
let languages = args.count >= 3
  ? args[2].split(separator: ",").map(String.init)
  : ["zh-Hans", "en-US"]

let url = URL(fileURLWithPath: path)
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  FileHandle.standardError.write("无法读取图片: \(path)\n".data(using: .utf8)!)
  exit(1)
}

let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]
let exifOrientation = properties?[kCGImagePropertyOrientation as String] as? Int ?? 1
let orientation = CGImagePropertyOrientation(rawValue: UInt32(exifOrientation)) ?? .up

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = languages
request.usesLanguageCorrection = true
if #available(macOS 11.0, *) {
  request.revision = VNRecognizeTextRequestRevision3
}

let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
do {
  try handler.perform([request])
} catch {
  FileHandle.standardError.write("OCR 失败: \(error)\n".data(using: .utf8)!)
  exit(1)
}

let imageWidth = Double(cgImage.width)
let imageHeight = Double(cgImage.height)
var blocks: [[String: Any]] = []

for observation in (request.results ?? []) {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let box = observation.boundingBox
  let x = box.origin.x * imageWidth
  let y = (1 - box.origin.y - box.height) * imageHeight
  blocks.append([
    "text": candidate.string,
    "x": round(x * 100) / 100,
    "y": round(y * 100) / 100,
    "width": round(box.width * imageWidth * 100) / 100,
    "height": round(box.height * imageHeight * 100) / 100,
    "confidence": round(candidate.confidence * 1000) / 1000
  ])
}

let payload: [String: Any] = [
  "width": imageWidth,
  "height": imageHeight,
  "blocks": blocks
]

if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
   let text = String(data: data, encoding: .utf8) {
  print(text)
} else {
  FileHandle.standardError.write("JSON 序列化失败\n".data(using: .utf8)!)
  exit(1)
}
