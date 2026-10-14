import XCTest
@testable import CompanionConversation

final class ConversationReadStateTests: XCTestCase {
    func testCoveredConversationStaysUnreadAndReturningAcknowledgesOnlyTheRenderedRevision() {
        var reads = ConversationReadState()
        reads.didRender(agentId: "agent", revision: 2)
        XCTAssertNil(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: false, reviewOpen: false, imageOpen: true))
        XCTAssertNil(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: false, reviewOpen: true))
        // Activity can advance on the laptop; until its transcript renders we acknowledge only revision 2.
        XCTAssertEqual(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: false, reviewOpen: false), .init(agentId: "agent", revision: 2))
        reads.didRender(agentId: "agent", revision: 3)
        XCTAssertNil(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: false, reviewOpen: true))
        XCTAssertEqual(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: false, reviewOpen: false), .init(agentId: "agent", revision: 3))
        XCTAssertNil(reads.acknowledgement(activeAgentId: "other", foreground: true, drawerOpen: false, reviewOpen: false))
        XCTAssertNil(reads.acknowledgement(activeAgentId: "agent", foreground: false, drawerOpen: false, reviewOpen: false))
        XCTAssertNil(reads.acknowledgement(activeAgentId: "agent", foreground: true, drawerOpen: true, reviewOpen: false))
    }
}
