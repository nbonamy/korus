import Foundation

// Line-delimited process harness for native interoperability tests; never included in the app.
@main struct CryptoRunner {
    static func main() throws {
        let crypto = try AppleCrypto(script: String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
        while let line = readLine() {
            do {
                guard let command = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw AppleCrypto.Failure.invalidRequest }
                let result = try crypto.execute(command)
                print(String(data: try JSONSerialization.data(withJSONObject: ["result": result]), encoding: .utf8)!)
            } catch { print("{\"error\":\"Native crypto rejected request\"}") }
            fflush(stdout)
        }
    }
}
