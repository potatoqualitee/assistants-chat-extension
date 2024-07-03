import * as vscode from 'vscode';
import { Wrapper, registerChatParticipant } from './wrapper';
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

    const azureDeployment = await vscode.window.showInputBox({
        placeHolder: 'Azure OpenAI Deployment Name',
    });

    if (!azureDeployment) {
        vscode.window.showErrorMessage('No Azure OpenAI deployment name provided. Please set your deployment name to use the AI assistant.');
        return false;
    }

    configuration.update('azureOpenAIApiKey', azureApiKey, vscode.ConfigurationTarget.Global);
    configuration.update('azureOpenAIEndpoint', azureEndpoint, vscode.ConfigurationTarget.Global);
    configuration.update('azureOpenAIDeploymentName', azureDeployment, vscode.ConfigurationTarget.Global);

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
    let azureDeployment: string = configuration.get<string>('azureOpenAIDeploymentName', '')!;

    // New code to determine the API provider
    let apiProvider = configuration.get<string>('apiProvider', 'auto');
    if (apiProvider === 'auto') {
        if (apiKey && azureApiKey) {
            apiProvider = await promptForApiProvider();
        } else if (apiKey) {
            apiProvider = 'openai';
        } else if (azureApiKey && azureEndpoint && azureDeployment) {
            apiProvider = 'azure';
        } else {
            apiProvider = 'openai';  // Default to OpenAI if no keys are set
        }
    }

    configuration.update('apiProvider', apiProvider, vscode.ConfigurationTarget.Global);

    const wrapper = new Wrapper({
        apiKey: apiProvider === 'azure' ? azureApiKey : apiKey,
        endpoint: apiProvider === 'azure' ? azureEndpoint : undefined,
        isAzure: apiProvider === 'azure',
        azureApiKey,
        azureEndpoint,
        azureDeployment,
    });

    await wrapper.init();

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
                await wrapper.init();
                await registerChatParticipant(context, wrapper, model, assistantId, configuration);
            }
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setAzureConfig', async () => {
            const azureConfigured = await promptForAzureConfiguration(configuration);

            if (azureConfigured) {
                azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
                azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
                azureDeployment = configuration.get<string>('azureOpenAIDeploymentName', '')!;
                const wrapper = new Wrapper({
                    apiKey: azureApiKey,
                    endpoint: azureEndpoint,
                    isAzure: true,
                    azureApiKey,
                    azureEndpoint,
                    azureDeployment,
                });
                await wrapper.init();
                vscode.window.showInformationMessage('Azure OpenAI configuration updated. Chat participant re-registered.');
                await registerChatParticipant(context, wrapper, model, assistantId, configuration);
            }
        }),

        vscode.commands.registerCommand('assistantsChatExtension.selectApiProvider', async () => {
            const newProvider = await promptForApiProvider();
            configuration.update('apiProvider', newProvider, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`API provider set to ${newProvider}. Please reload the window for changes to take effect.`);
        }),

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension.apiKey')) {
                const newApiKey = configuration.get<string>('apiKey', '');
                if (newApiKey) {
                    const wrapper = new Wrapper({
                        apiKey: newApiKey,
                        isAzure: false,
                    });
                    await wrapper.init();
                    await registerChatParticipant(context, wrapper, model, assistantId, configuration);
                    vscode.window.showInformationMessage('API key updated. Chat participant re-registered.');
                }
            } else if (event.affectsConfiguration('assistantsChatExtension.azureOpenAIApiKey') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIEndpoint') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIDeploymentName')) {
                azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
                azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
                azureDeployment = configuration.get<string>('azureOpenAIDeploymentName', '')!;
                if (azureApiKey && azureEndpoint && azureDeployment) {
                    const wrapper = new Wrapper({
                        apiKey: azureApiKey,
                        endpoint: azureEndpoint,
                        isAzure: true,
                        azureApiKey,
                        azureEndpoint,
                        azureDeployment,
                    });
                    await wrapper.init();
                    await registerChatParticipant(context, wrapper, model, assistantId, configuration);
                    vscode.window.showInformationMessage('Azure OpenAI configuration updated. Chat participant re-registered.');
                }
            }
        })
    );
}

async function promptForApiProvider(): Promise<string> {
    const choice = await vscode.window.showQuickPick(
        ['OpenAI', 'Azure OpenAI'],
        { placeHolder: 'Select API provider' }
    );
    return choice === 'Azure OpenAI' ? 'azure' : 'openai';
}

export function deactivate() { }