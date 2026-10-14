import SwiftUI
import UIKit

/// Native rich editing with the same canonical `$alias` prompt as the SDK editor.
struct SkillComposerEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange?
    @Binding var focused: Bool
    @Binding var query: SkillQuery?
    let skills: [ComposerSkill]
    let editable: Bool
    let maxLines: Int
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> SkillTextView {
        let view = SkillTextView()
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityLabel = "Message"
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ view: SkillTextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.updating = true
        defer { coordinator.updating = false }
        let font = UIFont.preferredFont(forTextStyle: .body)
        let appearance = "\(colorScheme)-\(dynamicTypeSize)"
        let catalogChanged = coordinator.skills != skills
        if view.document.text != text || catalogChanged || coordinator.appearance != appearance {
            let caret = selection ?? NSRange(location: text.utf16.count, length: 0)
            // Don't interrupt an in-progress IME composition.
            if view.markedTextRange == nil {
                view.render(SkillChipText(text: text, skills: skills), selection: caret, font: font)
                coordinator.skills = skills
                coordinator.appearance = appearance
            }
        } else if let selection, view.document.canonicalRange(view.selectedRange) != selection, view.markedTextRange == nil {
            view.selectedRange = view.document.renderedRange(selection)
        }
        view.isEditable = editable
        view.placeholder.isHidden = !text.isEmpty
        view.placeholder.font = font
        view.invalidateIntrinsicContentSize()
        if focused && editable && !view.isFirstResponder { view.becomeFirstResponder() }
        if !focused && view.isFirstResponder { view.resignFirstResponder() }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: SkillTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let lineHeight = UIFont.preferredFont(forTextStyle: .body).lineHeight
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: min(max(lineHeight + 4, fitting.height), lineHeight * CGFloat(maxLines) + 4))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SkillComposerEditor
        var updating = false
        var skills: [ComposerSkill] = []
        var appearance = ""
        init(_ parent: SkillComposerEditor) { self.parent = parent }

        func textViewDidBeginEditing(_ textView: UITextView) { if !updating { parent.focused = true; publishSelection(textView) } }
        func textViewDidEndEditing(_ textView: UITextView) { if !updating { parent.focused = false } }
        func textViewDidChangeSelection(_ textView: UITextView) { if !updating { publishSelection(textView) } }

        func textViewDidChange(_ textView: UITextView) {
            guard !updating, let view = textView as? SkillTextView else { return }
            let document = view.document
            let selection = document.canonicalRange(view.selectedRange)
            parent.text = document.text
            // Leave the active query editable; completed and pasted mentions can become chips.
            if view.markedTextRange == nil, SkillQuery.at(document.text, selection: selection) == nil {
                let rendered = SkillChipText(text: document.text, skills: parent.skills)
                if rendered.chips != document.chips {
                    updating = true
                    view.render(rendered, selection: selection, font: UIFont.preferredFont(forTextStyle: .body))
                    updating = false
                }
            }
            view.placeholder.isHidden = !document.text.isEmpty
            view.invalidateIntrinsicContentSize()
            publishSelection(view)
        }

        private func publishSelection(_ textView: UITextView) {
            guard let view = textView as? SkillTextView else { return }
            let document = view.document
            let selection = document.canonicalRange(view.selectedRange)
            parent.selection = selection
            let query = SkillQuery.at(document.text, selection: selection)
            parent.query = document.chips.contains(where: { $0.range == query?.range }) ? nil : query
        }
    }
}

final class SkillTextView: UITextView {
    let placeholder = UILabel()

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholder.text = "Message"
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false
        placeholder.isAccessibilityElement = false
        addSubview(placeholder)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var accessibilityValue: String? {
        get {
            let document = document
            let spoken = NSMutableString(string: document.text)
            for chip in document.chips.reversed() { spoken.replaceCharacters(in: chip.range, with: chip.skill.name) }
            return spoken as String
        }
        set { super.accessibilityValue = newValue }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        placeholder.frame = CGRect(x: 0, y: 0, width: bounds.width, height: font?.lineHeight ?? 24)
    }

    var document: SkillChipText {
        var canonical = ""
        var chips: [SkillChipText.Chip] = []
        textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textStorage.length)) { value, range, _ in
            if let attachment = value as? SkillAttachment {
                chips.append(.init(range: NSRange(location: canonical.utf16.count, length: attachment.token.utf16.count), skill: attachment.skill))
                canonical += attachment.token
            } else {
                canonical += (textStorage.string as NSString).substring(with: range)
            }
        }
        return SkillChipText(text: canonical, chips: chips)
    }

    func render(_ document: SkillChipText, selection: NSRange, font: UIFont) {
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.label]
        let result = NSMutableAttributedString(string: document.text, attributes: attributes)
        for chip in document.chips.reversed() {
            let token = (document.text as NSString).substring(with: chip.range)
            let attachment = SkillAttachment(token: token, skill: chip.skill, font: font, tint: tintColor, traits: traitCollection)
            result.replaceCharacters(in: chip.range, with: NSAttributedString(attachment: attachment))
        }
        attributedText = result
        typingAttributes = attributes
        selectedRange = document.renderedRange(selection)
    }

    override func copy(_ sender: Any?) {
        let document = document
        UIPasteboard.general.string = (document.text as NSString).substring(with: document.canonicalRange(selectedRange))
    }

    override func cut(_ sender: Any?) {
        guard isEditable, selectedRange.length > 0 else { return }
        copy(sender)
        insertText("")
    }

    override func paste(_ sender: Any?) {
        guard isEditable, let text = UIPasteboard.general.string else { return }
        insertText(text)
    }
}

private final class SkillAttachment: NSTextAttachment {
    let token: String
    let skill: ComposerSkill

    init(token: String, skill: ComposerSkill, font: UIFont, tint: UIColor, traits: UITraitCollection) {
        self.token = token
        self.skill = skill
        super.init(data: nil, ofType: nil)
        let chipFont = UIFont.preferredFont(forTextStyle: .subheadline)
        let label = skill.name as NSString
        let labelWidth = min(220, ceil(label.size(withAttributes: [.font: chipFont]).width))
        let height = ceil(chipFont.lineHeight + 6)
        let size = CGSize(width: labelWidth + 30, height: height)
        let foreground = tint.resolvedColor(with: traits)
        image = UIGraphicsImageRenderer(size: size).image { _ in
            foreground.withAlphaComponent(0.14).setFill()
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 6).fill()
            let icon = UIImage(systemName: "sparkles", withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .medium))?
                .withTintColor(foreground, renderingMode: .alwaysOriginal)
            icon?.draw(in: CGRect(x: 6, y: (height - 14) / 2, width: 14, height: 14))
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineBreakMode = .byTruncatingTail
            label.draw(in: CGRect(x: 24, y: 3, width: labelWidth, height: chipFont.lineHeight), withAttributes: [.font: chipFont, .foregroundColor: foreground, .paragraphStyle: paragraph])
        }
        bounds = CGRect(x: 0, y: font.descender - (height - font.lineHeight) / 2, width: size.width, height: height)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
