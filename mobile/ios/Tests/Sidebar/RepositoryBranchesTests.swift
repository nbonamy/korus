import XCTest
@testable import CompanionSidebar

final class RepositoryBranchesTests: XCTestCase {
    func testBranchChoicesDecodeAndSearchWithoutLosingCheckoutOrDefaultStatus() throws {
        let data = Data(#"{"repositoryId":"repo","status":"loaded","items":[{"name":"main","isDefault":true,"isCheckedOut":true},{"name":"feature/Login","isDefault":false,"isCheckedOut":false}]}"#.utf8)
        let catalog = try JSONDecoder().decode(RepositoryBranches.self, from: data)
        XCTAssertEqual(catalog.repositoryId, "repo")
        XCTAssertEqual(catalog.status, .loaded)
        XCTAssertEqual(catalog.matching("  MAIN "), [.init(name: "main", isDefault: true, isCheckedOut: true)])
        XCTAssertEqual(catalog.matching("login"), [.init(name: "feature/Login", isDefault: false, isCheckedOut: false)])
        XCTAssertEqual(catalog.matching("  "), catalog.items)
        XCTAssertTrue(catalog.matching("missing").isEmpty)
    }
}
