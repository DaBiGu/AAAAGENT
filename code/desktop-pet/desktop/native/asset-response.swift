import Foundation

// A pure file/range plan, shared by WKURLSchemeHandler and synthetic native tests.
// The host streams at most one 64 KiB chunk at a time; this type never loads media.
struct PetAssetResponse {
    let file: URL
    let status: Int
    let headers: [String: String]
    let offset: UInt64
    let length: UInt64

    static func prepare(root: URL, url: URL, range: String?) throws -> PetAssetResponse {
        guard url.scheme == "pet", url.host == "app", url.user == nil, url.password == nil,
              url.port == nil else { throw URLError(.badURL) }
        let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        guard !path.isEmpty, !path.contains("\\"), !path.contains(":"), !path.contains("\0"),
              !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0 == ".." || $0 == "." })
        else { throw URLError(.noPermissionsToReadFile) }
        let base = root.standardizedFileURL.resolvingSymlinksInPath()
        let file = base.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(base.path + "/") else { throw URLError(.noPermissionsToReadFile) }
        let values = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let rawSize = values.fileSize, rawSize >= 0
        else { throw URLError(.fileDoesNotExist) }
        let size = UInt64(rawSize)
        let mime = ["js":"text/javascript", "mjs":"text/javascript", "json":"application/json",
                    "css":"text/css", "html":"text/html", "wasm":"application/wasm", "png":"image/png",
                    "jpg":"image/jpeg", "jpeg":"image/jpeg", "svg":"image/svg+xml",
                    "webm":"video/webm", "mp4":"video/mp4", "woff2":"font/woff2"][file.pathExtension.lowercased()]
                    ?? "application/octet-stream"
        var headers = ["Content-Type":mime, "Accept-Ranges":"bytes", "Cache-Control":"no-store"]
        var status = 200, offset: UInt64 = 0, length = size
        if let range {
            let reject = { () -> PetAssetResponse in
                var rejected = headers
                rejected["Content-Range"] = "bytes */\(size)"
                rejected["Content-Length"] = "0"
                return PetAssetResponse(file:file, status:416, headers:rejected, offset:0, length:0)
            }
            guard range.hasPrefix("bytes="), size > 0 else { return reject() }
            let parts = range.dropFirst(6).split(separator:"-", omittingEmptySubsequences:false)
            guard parts.count == 2, !(parts[0].isEmpty && parts[1].isEmpty),
                  parts.allSatisfy({ $0.allSatisfy({ $0 >= "0" && $0 <= "9" }) }) else { return reject() }
            let end: UInt64
            if parts[0].isEmpty {
                guard let suffix = UInt64(parts[1]), suffix > 0 else { return reject() }
                offset = size - min(size, suffix); end = size - 1
            } else {
                guard let start = UInt64(parts[0]), start < size else { return reject() }
                offset = start
                if parts[1].isEmpty { end = size - 1 }
                else {
                    guard let requestedEnd = UInt64(parts[1]), requestedEnd >= start else { return reject() }
                    end = min(size - 1, requestedEnd)
                }
            }
            length = end - offset + 1; status = 206
            headers["Content-Range"] = "bytes \(offset)-\(end)/\(size)"
        }
        headers["Content-Length"] = String(length)
        return PetAssetResponse(file:file, status:status, headers:headers, offset:offset, length:length)
    }
}
