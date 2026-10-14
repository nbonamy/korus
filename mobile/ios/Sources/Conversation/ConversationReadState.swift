/// Retains the transcript's rendered revision while another native surface covers it.
struct ConversationReadState {
    struct Acknowledgement: Equatable { let agentId: String; let revision: Int }
    private var rendered: Acknowledgement?

    mutating func didRender(agentId: String, revision: Int) {
        rendered = .init(agentId: agentId, revision: revision)
    }

    func acknowledgement(activeAgentId: String?, foreground: Bool, drawerOpen: Bool, reviewOpen: Bool, imageOpen: Bool = false) -> Acknowledgement? {
        guard foreground, !drawerOpen, !reviewOpen, !imageOpen, let rendered, rendered.agentId == activeAgentId else { return nil }
        return rendered
    }
}
