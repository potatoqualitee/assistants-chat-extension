import * as vscode from 'vscode';
import { Wrapper, registerChatParticipant } from './wrapper';
import { promptForAssistant } from './assistantUtils';

async function promptForApiKey(configuration: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext, model: string, assistantId: string | undefined): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        placeHolder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        password: true,
    });

    if (apiKey) {
        configuration.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
        console.log('API key updated successfully. You can now use the AI assistant.');
        const wrapper = new Wrapper({
            apiKey: apiKey,
            isAzure: false,
        });
        await wrapper.init();
        await registerChatParticipant(context, wrapper, model, assistantId, configuration);
        return apiKey;
    } else {
        vscode.window.showErrorMessage('No API key provided. Please set your API key to use the AI assistant.');
    }

    return undefined;
}

async function promptForAzureConfiguration(configuration: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext, model: string, assistantId: string | undefined): Promise<boolean> {
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

    return true;
}

async function promptForApiProvider(configuration: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext, model: string, assistantId: string | undefined): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'You need to enter an API key',
        'OpenAI',
        'Azure'
    );

    if (choice === 'OpenAI') {
        await promptForApiKey(configuration, context, model, assistantId);
        configuration.update('apiProvider', 'openai', vscode.ConfigurationTarget.Global);
    } else if (choice === 'Azure') {
        await promptForAzureConfiguration(configuration, context, model, assistantId);
        configuration.update('apiProvider', 'azure', vscode.ConfigurationTarget.Global);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
    const model = configuration.get<string>('model', 'gpt-3.5-turbo');
    let assistantId = configuration.get<string>('assistantId');
    let apiKey: string = configuration.get<string>('apiKey', '')!;
    let azureApiKey: string = configuration.get<string>('azureOpenAIApiKey', '')!;
    let azureEndpoint: string = configuration.get<string>('azureOpenAIEndpoint', '')!;
    let azureDeployment: string = configuration.get<string>('azureOpenAIDeploymentName', '')!;

    if (!apiKey && !azureApiKey) {
        await promptForApiProvider(configuration, context, model, assistantId);
        apiKey = configuration.get<string>('apiKey', '')!;
        azureApiKey = configuration.get<string>('azureOpenAIApiKey', '')!;
        azureEndpoint = configuration.get<string>('azureOpenAIEndpoint', '')!;
        azureDeployment = configuration.get<string>('azureOpenAIDeploymentName', '')!;
    }

    const apiProvider = configuration.get<string>('apiProvider', 'auto');
    const isAzure = apiProvider === 'azure' || (apiProvider === 'auto' && !!azureApiKey); // Ensure boolean
    const apiKeyToUse = isAzure ? azureApiKey : apiKey;

    const wrapper = new Wrapper({
        apiKey: apiKeyToUse!,
        endpoint: isAzure ? azureEndpoint! : undefined,
        isAzure,
        azureApiKey: azureApiKey || undefined,
        azureEndpoint: azureEndpoint || undefined,
        azureDeployment: azureDeployment || undefined,
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
            await promptForApiKey(configuration, context, model, assistantId);
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setAzureConfig', async () => {
            await promptForAzureConfiguration(configuration, context, model, assistantId);
        }),

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension.apiProvider') ||
                event.affectsConfiguration('assistantsChatExtension.apiKey') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIApiKey') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIEndpoint') ||
                event.affectsConfiguration('assistantsChatExtension.azureOpenAIDeploymentName')) {

                const apiProvider = configuration.get<string>('apiProvider', 'auto');
                const isAzure = apiProvider === 'azure' || (apiProvider === 'auto' && !!azureApiKey); // Ensure boolean
                const apiKeyToUse = isAzure ? azureApiKey : configuration.get<string>('apiKey', '');

                const wrapper = new Wrapper({
                    apiKey: apiKeyToUse!,
                    endpoint: isAzure ? azureEndpoint! : undefined,
                    isAzure,
                    azureApiKey: azureApiKey || undefined,
                    azureEndpoint: azureEndpoint || undefined,
                    azureDeployment: azureDeployment || undefined,
                });
                await wrapper.init();
                await registerChatParticipant(context, wrapper, model, assistantId, configuration);
                vscode.window.showInformationMessage('Configuration updated. Chat participant re-registered.');
            }
        })
    );
}

export function deactivate() { }
