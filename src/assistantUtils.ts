// assistantUtils.ts
import * as vscode from 'vscode';
import { Wrapper, Assistant } from './wrapper';

export async function promptForAssistant(wrapper: Wrapper, configuration: vscode.WorkspaceConfiguration, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
    if (stream) {
        stream.markdown('Please select an assistant.\n');
    }

    const assistants = await wrapper.getAssistants();
    const assistantNames = assistants.map((assistant: Assistant) => assistant.name).filter((name): name is string => name !== null);
    const selectedAssistantName = await vscode.window.showQuickPick(assistantNames, {
        placeHolder: 'Select an assistant',
    });

    if (selectedAssistantName) {
        const selectedAssistant = assistants.find((assistant: Assistant) => assistant.name === selectedAssistantName);
        if (selectedAssistant) {
            configuration.update('assistantId', selectedAssistant.id, vscode.ConfigurationTarget.Global);
            if (stream) {
                stream.markdown(`Selected assistant: ${selectedAssistantName}\n`);
            }
            return selectedAssistant.id;
        }
    } else {
        if (stream) {
            stream.markdown('No assistant selected. Please select an assistant to proceed.');
        }
    }

    return undefined;
}