import Foundation

@main
struct AssetResponseTest {
    static func expect(_ value: @autoclosure () -> Bool, _ label: String) {
        precondition(value(), label)
    }
    static func main() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("aaaagent-asset-test-\(UUID().uuidString)", isDirectory:true)
        let root = temporary.appendingPathComponent("public", isDirectory:true)
        try FileManager.default.createDirectory(at:root, withIntermediateDirectories:true)
        defer { try? FileManager.default.removeItem(at:temporary) }
        try Data("0123456789".utf8).write(to:root.appendingPathComponent("测试.webm"))
        try Data().write(to:root.appendingPathComponent("empty.webm"))
        let url = URL(string:"pet://app/测试.webm")!
        func plan(_ range: String?) throws -> PetAssetResponse { try PetAssetResponse.prepare(root:root,url:url,range:range) }
        let full = try plan(nil)
        expect(full.status == 200 && full.length == 10, "full response")
        expect(full.headers["Content-Type"] == "video/webm", "video MIME")
        let partial = try plan("bytes=3-6")
        expect(partial.status == 206 && partial.offset == 3 && partial.length == 4, "bounded range")
        expect(partial.headers["Content-Range"] == "bytes 3-6/10", "range header")
        let handle = try FileHandle(forReadingFrom:partial.file)
        try handle.seek(toOffset:partial.offset)
        let bytes = try handle.read(upToCount:Int(partial.length))
        try handle.close()
        expect(bytes == Data("3456".utf8), "selected bytes")
        let suffix = try plan("bytes=-2"), open = try plan("bytes=8-"), clamp = try plan("bytes=8-999")
        expect(suffix.offset == 8 && suffix.length == 2, "suffix")
        expect(open.offset == 8 && open.length == 2, "open range")
        expect(clamp.offset == 8 && clamp.length == 2, "clamped range")
        for invalid in ["bytes=99-", "bytes=4-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5", "bytes=18446744073709551616-", "items=0-1"] {
            let rejected = try plan(invalid)
            expect(rejected.status == 416 && rejected.length == 0, "invalid range \(invalid)")
            expect(rejected.headers["Content-Range"] == "bytes */10", "unsatisfied range header")
        }
        let empty = try PetAssetResponse.prepare(root:root,url:URL(string:"pet://app/empty.webm")!,range:nil)
        expect(empty.length == 0 && empty.status == 200, "empty file")
        let outside = temporary.appendingPathComponent("private.txt")
        try Data("synthetic".utf8).write(to:outside)
        try FileManager.default.createSymbolicLink(at:root.appendingPathComponent("escape.webm"),withDestinationURL:outside)
        for forbidden in ["pet://other/测试.webm", "pet://user@app/测试.webm", "pet://app/escape.webm", "pet://app/%2e%2e/private.txt"] {
            do {
                _ = try PetAssetResponse.prepare(root:root,url:URL(string:forbidden)!,range:nil)
                preconditionFailure("accepted forbidden path")
            } catch {}
        }
        print("Native synthetic asset ranges and path boundaries passed.")
    }
}
