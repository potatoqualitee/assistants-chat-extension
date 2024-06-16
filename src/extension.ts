import * as vscode from 'vscode';
import { Wrapper, registerChatParticipant, Assistant } from './wrapper';
import { promptForAssistant } from './assistantUtils';

async function promptForApiKey(configuration: vscode.WorkspaceConfiguration): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        placeHolder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
    });

    if (apiKey) {
        configuration.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        console.log('API key updated successfully. You can now use the AI assistant.');
        return apiKey;
    } else {
        vscode.window.showErrorMessage('No API key provided. Please set your API key to use the AI assistant.');
    }

    return undefined;
}

async function promptForAzureConfiguration(configuration: vscode.WorkspaceConfiguration): Promise<boolean> {
    const azureApiKey = await vscode.window.showInputBox({
        placeHolder: 'Azure OpenAI API Key',
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

    configuration.update('azureOpenAIApiKey', azureApiKey, vscode.ConfigurationTarget.Global);
    configuration.update('azureOpenAIEndpoint', azureEndpoint, vscode.ConfigurationTarget.Global);

    console.log('Azure OpenAI configuration updated successfully. You can now use the AI assistant with Azure OpenAI.');
    return true;
}

export async function activate(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
    const model = configuration.get<string>('model', 'gpt-3.5-turbo');
    let assistantId = configuration.get<string>('assistantId');
    let apiKey: string = configuration.get<string>('apiKey', '')!;
    let azureApiKey: string = configuration.get<string>('azureOpenAIApiKey', '')!;
    let azureEndpoint: string = configuration.get<string>('azureOpenAIEndpoint', '')!;
    let isAzure = false;

    if (azureApiKey && azureEndpoint) {
        isAzure = true;
    } else if (!apiKey) {
        const choice = await vscode.window.showInformationMessage('No API key or Azure OpenAI configuration found. Please set up your preferred provider.', 'OpenAI', 'Azure OpenAI');

        if (choice === 'OpenAI') {
            apiKey = (await promptForApiKey(configuration))!;
            if (!apiKey) {
                return;
            }
        } else if (choice === 'Azure OpenAI') {
            const azureConfigured = await promptForAzureConfiguration(configuration);
            if (!azureConfigured) {
                return;
            }
            azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
            azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
            isAzure = true;
        } else {
            return;
        }
    }

    const wrapper = new Wrapper({
        apiKey: isAzure ? azureApiKey : apiKey,
        endpoint: isAzure ? azureEndpoint : undefined,
        isAzure,
    });

    await registerChatParticipant(context, wrapper, model, assistantId, configuration);

    context.subscriptions.push(
        vscode.commands.registerCommand('assistantsChatExtension.selectAssistant', async () => {
            try {
                assistantId = await promptForAssistant(wrapper, configuration);
                if (assistantId) {
                    const updatedAssistantId = configuration.get<string>('assistantId');
                    if (updatedAssistantId !== assistantId) {
                        configuration.update('assistantId', assistantId, vscode.ConfigurationTarget.Global);
                    }
                }
            } catch (err) {
                console.error('Failed to retrieve assistants:', err);
                vscode.window.showErrorMessage('Failed to retrieve assistants. Please check your network connection.');
            }
        }),
        vscode.commands.registerCommand('assistantsChatExtension.setApiKey', async () => {
            const newApiKey = await promptForApiKey(configuration);

            if (newApiKey) {
                configuration.update('apiKey', newApiKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('API key updated. Chat participant re-registered.');
                const wrapper = new Wrapper({
                    apiKey: newApiKey,
                    isAzure: false,
                });
                await registerChatParticipant(context, wrapper, model, assistantId, configuration);
            }
        }),
        vscode.commands.registerCommand('assistantsChatExtension.setAzureConfig', async () => {
            const azureConfigured = await promptForAzureConfiguration(configuration);

            if (azureConfigured) {
                azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
                azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
                const wrapper = new Wrapper({
                    apiKey: azureApiKey,
                    endpoint: azureEndpoint,
                    isAzure: true,
                });
                vscode.window.showInformationMessage('Azure OpenAI configuration updated. Chat participant re-registered.');
                await registerChatParticipant(context, wrapper, model, assistantId, configuration);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension.apiKey')) {
                const newApiKey = configuration.get<string>('apiKey', '');
                if (newApiKey) {
                    const wrapper = new Wrapper({
                        apiKey: newApiKey,
                        isAzure: false,
                    });
                    await registerChatParticipant(context, wrapper, model, assistantId, configuration);
                    vscode.window.showInformationMessage('API key updated. Chat participant re-registered.');
                }
            } else if (event.affectsConfiguration('assistantsChatExtension.azureOpenAIApiKey') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIEndpoint')) {
                azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
                azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
                if (azureApiKey && azureEndpoint) {
                    const wrapper = new Wrapper({
                        apiKey: azureApiKey,
                        endpoint: azureEndpoint,
                        isAzure: true,
                    });
                    await registerChatParticipant(context, wrapper, model, assistantId, configuration);
                    vscode.window.showInformationMessage('Azure OpenAI configuration updated. Chat participant re-registered.');
                }
            }
        })
    );
}

export function deactivate() { }