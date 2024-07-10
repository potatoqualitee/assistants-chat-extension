import * as vscode from 'vscode';
import { Wrapper } from './wrapper';
import { Assistant } from './openai';

const newlineSpacing = `\n
            
            \n`;

export async function promptForAssistant(wrapper: Wrapper, configuration: vscode.WorkspaceConfiguration, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
    const assistants = await wrapper.getAssistants();

    if (assistants.length === 0) {
        const choice = await vscode.window.showInformationMessage(
            'No assistants found. Would you like to create a sample "Beavis and Butthead" assistant?',
            'Yes',
            'No'
        );

        if (choice === 'Yes') {
            try {
                const assistant = await wrapper.createSampleAssistant();
                if (assistant) {
                    if (stream) {
                        stream.markdown(`Sample assistant "Beavis and Butthead" created successfully. You can now chat with it.${newlineSpacing}`);
                    }
                    return assistant.id;
                }
            } catch (error) {
                console.error("Error creating sample assistant:", error);
                if (stream) {
                    stream.markdown(`An error occurred while creating the sample assistant. Please create one manually using the web interface or PSOpenAI.${newlineSpacing}`);
                }
            }
        } else {
            if (stream) {
                stream.markdown(`No assistants available. Please create an assistant to proceed.${newlineSpacing}`);
            }
            return undefined;
        }
    } else if (assistants.length === 1) {
        const assistant = assistants[0];
        configuration.update('assistantId', assistant.id, vscode.ConfigurationTarget.Global);
        if (stream) {
            stream.markdown(`Automatically selected assistant: ${assistant.name || assistant.id}${newlineSpacing}`);
        }
        return assistant.id;
    } else {
        if (stream) {
            stream.markdown(`Please select an assistant.${newlineSpacing}`);
        }
    }

    const assistantNames = assistants.map((assistant: Assistant) => assistant.name).filter((name): name is string => name !== null);
    const selectedAssistantName = await vscode.window.showQuickPick(assistantNames, {
        placeHolder: 'Select an assistant',
    });

    if (selectedAssistantName) {
        const selectedAssistant = assistants.find((assistant: Assistant) => assistant.name === selectedAssistantName);
        if (selectedAssistant) {
            configuration.update('assistantId', selectedAssistant.id, vscode.ConfigurationTarget.Global);
            if (stream) {
                stream.markdown(`Selected assistant: ${selectedAssistantName}${newlineSpacing}`);
            }
            return selectedAssistant.id;
        }
    } else {
        if (stream) {
            stream.markdown(`No assistant selected. Please select an assistant to proceed.${newlineSpacing}`);
        }
    }

    return undefined;
}