import SwiftUI

/// Above the composer of an empty chat: the engines this laptop can run, the chosen one checked.
/// It leaves with the first prompt, because the engine cannot change afterwards.
struct EngineChoiceList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            ForEach(model.conversationProviders, id: \.self) { provider in
                let selected = provider == (model.switchingProvider ?? model.provider)
                Button { model.chooseProvider(provider) } label: {
                    HStack(spacing: 12) {
                        Group {
                            if UIImage(named: "provider-\(provider)") != nil {
                                Image("provider-\(provider)").renderingMode(.template).resizable().scaledToFit()
                            } else {
                                Image(systemName: "sparkles").resizable().scaledToFit().padding(2)
                            }
                        }
                        .frame(width: 20, height: 20)
                        Text(provider.engineName)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.primary)
                        Spacer(minLength: 0)
                        if selected { Image(systemName: "checkmark").font(.system(size: 15, weight: .semibold)) }
                    }
                    .foregroundStyle(selected ? Color.accentColor : .primary)
                    .padding(.horizontal, 12)
                    .frame(height: 40)
                    .background(selected ? Color.accentColor.opacity(0.12) : .clear, in: .rect(cornerRadius: 12, style: .continuous))
                    .contentShape(.rect(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(provider.engineName)
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .padding(6)
        .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
