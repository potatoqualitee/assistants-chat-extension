import * as vscode from 'vscode';
import { Wrapper, registerChatParticipant, promptForAssistant } from './wrapper';
import { Assistant } from './openai';

let chatParticipant: vscode.ChatParticipant | undefined;
let chatParticipantCreated = false;

/**
 * Prompts the user for an OpenAI API key.
 * @param configuration - The workspace configuration.
 * @returns The entered API key.
 */
async function promptForApiKey(configuration: vscode.WorkspaceConfiguration): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        placeHolder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
    });

    if (apiKey) {
        await configuration.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        console.debug('API key updated successfully.');
        return apiKey;
    } else {
        vscode.window.showErrorMessage('No API key provided. Please set your API key to use the AI assistant.');
    }

    return undefined;
}

/**
 * Prompts the user for Azure OpenAI API key and endpoint.
 * @param configuration - The workspace configuration.
 * @returns True if the configuration was successful, false otherwise.
 */
async function promptForAzureConfiguration(configuration: vscode.WorkspaceConfiguration): Promise<boolean> {
    const azureApiKey = await vscode.window.showInputBox({
        placeHolder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
    });

    if (!azureApiKey) {
        vscode.window.showErrorMessage('No Azure OpenAI API key provided. Please set your API key to use the AI assistant.');
        return false;
    }

    const azureEndpoint = await vscode.window.showInputBox({
        placeHolder: 'Azure OpenAI Endpoint',
    });

    if (!azureEndpoint) {
        vscode.window.showErrorMessage('No Azure OpenAI endpoint provided. Please set your endpoint to use the AI assistant.');
        return false;
    }

    await configuration.update('azureOpenAIApiKey', azureApiKey, vscode.ConfigurationTarget.Global);
    await configuration.update('azureOpenAIEndpoint', azureEndpoint, vscode.ConfigurationTarget.Global);

    console.debug('Azure OpenAI configuration updated successfully.');
    return true;
}

/**
 * Prompts the user to select an API provider.
 * @param configuration - The workspace configuration.
 */
async function promptForApiProvider(configuration: vscode.WorkspaceConfiguration): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'You must provide an API key to use the AI assistant. Would you like to use OpenAI or Azure OpenAI? Make sure you have your key ready before making a selection. Otherwise, you can add it later in the settings.',
        'OpenAI',
        'Azure'
    );

    if (choice === 'OpenAI') {
        await promptForApiKey(configuration);
        await configuration.update('apiProvider', 'openai', vscode.ConfigurationTarget.Global);
    } else if (choice === 'Azure') {
        await promptForAzureConfiguration(configuration);
        await configuration.update('apiProvider', 'azure', vscode.ConfigurationTarget.Global);
    }
}

/**
 * Creates a wrapper instance based on the configuration.
 * @param configuration - The workspace configuration.
 * @returns The created wrapper instance.
 */
async function createWrapper(configuration: vscode.WorkspaceConfiguration): Promise<Wrapper> {
    const apiProvider = configuration.get<string>('apiProvider', 'auto');
    const isAzure = apiProvider === 'azure' || (apiProvider === 'auto' && !!configuration.get<string>('azureOpenAIApiKey'));
    const apiKey = isAzure ? configuration.get<string>('azureOpenAIApiKey') : configuration.get<string>('apiKey');
    const azureEndpoint = configuration.get<string>('azureOpenAIEndpoint');

    const wrapper = new Wrapper({
        apiKey: apiKey!,
        endpoint: isAzure ? azureEndpoint! : undefined,
        isAzure,
        azureApiKey: isAzure ? apiKey : undefined,
        azureEndpoint: azureEndpoint || undefined
    });
    await wrapper.init();
    return wrapper;
}

/**
 * Updates the chat participant with the current configuration.
 * @param context - The extension context.
 * @param configuration - The workspace configuration.
 */
async function updateChatParticipant(context: vscode.ExtensionContext, configuration: vscode.WorkspaceConfiguration) {
    const model = configuration.get<string>('model', 'gpt-3.5-turbo');
    let assistantId = context.workspaceState.get<string>('savedAssistantId', '');
    const wrapper = await createWrapper(configuration);

    if (assistantId) {
        const assistants = await wrapper.getAssistants();
        const savedAssistant = assistants.find((assistant: Assistant) => assistant.id === assistantId);

        if (!savedAssistant) {
            console.log("Saved assistant not found. Clearing savedAssistantId.");
            context.workspaceState.update('savedAssistantId', undefined);
            assistantId = '';
        }
    }

    if (!assistantId) {
        const newAssistantId = await promptForAssistant(wrapper, context);
        if (newAssistantId) {
            assistantId = newAssistantId;
            context.workspaceState.update('savedAssistantId', assistantId);
        } else {
            console.warn('No assistant selected. The chat participant cannot be created.');
            return;
        }
    }

    const chatParticipant = await registerChatParticipant(context, wrapper, model, assistantId);
    console.log(`Chat participant updated with model: ${model} and assistantId: ${assistantId}`);
}

/**
 * Activates the extension.
 * @param context - The extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
    console.debug('Activating Assistants Chat Extension');

    let configuration = vscode.workspace.getConfiguration('assistantsChatExtension');

    const sendCodeContext = configuration.get<boolean>('sendCodeContext', true);

    if (sendCodeContext) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const document = activeEditor.document;
            const fileType = document.languageId;
            const codeSnippet = document.getText();
            const tokenCount = estimateTokenCount(codeSnippet);

            console.log(`File type: ${fileType}, Token count for current snippet: ${tokenCount}`);
        }
    }

    if (!configuration.get<string>('apiKey') && !configuration.get<string>('azureOpenAIApiKey')) {
        await promptForApiProvider(configuration);
        configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
    }

    try {
        await updateChatParticipant(context, configuration);
    } catch (error) {
        console.error('Failed to update chat participant:', error);
        // Instead of throwing an error, we'll just log it and continue
        // This allows the extension to activate even if updating the chat participant fails
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('assistantsChatExtension.selectAssistant', async () => {
            try {
                const wrapper = await createWrapper(configuration);
                const assistantId = await promptForAssistant(wrapper, context);
                if (assistantId) {
                    try {
                        await updateChatParticipant(context, configuration);
                    } catch (error) {
                        console.error('Failed to update chat participant:', error);
                        vscode.window.showErrorMessage('Failed to update chat participant. The extension may not function correctly.');
                    }
                }
            } catch (err) {
                console.error('Failed to retrieve assistants:', err);
                vscode.window.showErrorMessage('Failed to retrieve assistants. Please check your network connection.');
            }
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setApiKey', async () => {
            await promptForApiKey(configuration);
            configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
            try {
                await updateChatParticipant(context, configuration);
            } catch (error) {
                console.error('Failed to update chat participant:', error);
                vscode.window.showErrorMessage('Failed to update chat participant. The extension may not function correctly.');
            }
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setAzureConfig', async () => {
            await promptForAzureConfiguration(configuration);
            configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
            try {
                await updateChatParticipant(context, configuration);
            } catch (error) {
                console.error('Failed to update chat participant:', error);
                vscode.window.showErrorMessage('Failed to update chat participant. The extension may not function correctly.');
            }
        }),

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension')) {
                const newConfiguration = vscode.workspace.getConfiguration('assistantsChatExtension');

                if (event.affectsConfiguration('assistantsChatExtension.apiProvider')) {
                    const oldProvider = configuration.get<string>('apiProvider');
                    const newProvider = newConfiguration.get<string>('apiProvider');

                    if (oldProvider !== newProvider) {
                        try {
                            await updateChatParticipant(context, newConfiguration);
                        } catch (error) {
                            console.error('Failed to update chat participant:', error);
                            vscode.window.showErrorMessage('Failed to update chat participant. The extension may not function correctly.');
                        }
                    }
                }

                configuration = newConfiguration;
                try {
                    await updateChatParticipant(context, configuration);
                } catch (error) {
                    console.error('Failed to update chat participant:', error);
                    vscode.window.showErrorMessage('Failed to update chat participant. The extension may not function correctly.');
                }
            }
        })
    );

    console.debug('Assistants Chat Extension activated');
}

/**
 * Deactivates the extension.
 */
export function deactivate() {
    if (chatParticipant) {
        chatParticipant.dispose();
    }
}

function estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
}