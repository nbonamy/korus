import XCTest
@testable import CompanionRequests

final class PendingRequestTests: XCTestCase {
    func testChangedApprovalDetailsAreNotDeduplicatedByRequestIdentity() throws {
        let json = #"{"key":"key","target":{"hostId":"host","locationId":"local","teamId":"team","agentId":"agent"},"request":{"id":"request","conversationId":"conversation","kind":"approval","approval":{"title":"Run command?","command":"pwd"}}}"#
        let decode = { (value: String) in try JSONDecoder().decode(PendingRequest.self, from: Data(value.utf8)) }
        let original = try decode(json)
        XCTAssertEqual(original, try decode(json))
        XCTAssertNotEqual(original, try decode(json.replacingOccurrences(of: "pwd", with: "ls")))
    }
    private func question(_ id: String, multi: Bool = false) -> PendingRequest.Question {
        .init(id: id, header: "Choice", question: "Which?", isSecret: false, multiSelect: multi,
              options: [.init(label: "One", description: ""), .init(label: "Two", description: "")])
    }
    func testSingleChoiceCustomAnswerAndMultiChoicePreserveStableQuestionIDs() {
        let single = question("single")
        let multi = question("multi", multi: true)
        var draft = RequestDraft()
        XCTAssertNil(draft.answers(for: [single, multi]))
        draft.toggle("One", for: single)
        draft.toggle("Two", for: single)
        draft.toggle("Two", for: multi)
        draft.toggle("One", for: multi)
        draft.text["single"] = "My own answer"
        draft.text["multi"] = "Third"
        XCTAssertEqual(draft.answers(for: [single, multi]), [
            "single": ["answers": ["My own answer"]], "multi": ["answers": ["One", "Two", "Third"]]
        ])
        draft.toggle("One", for: multi)
        XCTAssertEqual(draft.answers(for: [multi]), ["multi": ["answers": ["Two", "Third"]]])
    }
    func testNativeReplyCarriesOriginalHostSessionAndRequestEvenWhenNoSessionExists() throws {
        let json = #"{"key":"key","target":{"hostId":"host","locationId":"remote","teamId":"team","agentId":"agent","sessionId":null},"request":{"id":"request","conversationId":"conversation","kind":"toolConfirmation","confirmation":{"integrationName":"Tool","toolName":"Run","summary":"Run command?","argumentsPreview":"pwd","allowAlways":false}}}"#
        let pending = try JSONDecoder().decode(PendingRequest.self, from: Data(json.utf8))
        let reply = try XCTUnwrap(pending.reply(outcome: ["kind": "decision", "decision": "deny"]))
        XCTAssertEqual(reply["id"] as? String, "request")
        XCTAssertEqual(reply["conversationId"] as? String, "conversation")
        let target = try XCTUnwrap(reply["target"] as? [String: Any])
        XCTAssertEqual(target["agentId"] as? String, "agent")
        XCTAssertEqual(target["locationId"] as? String, "remote")
        XCTAssertTrue(target["sessionId"] is NSNull)
    }
}
