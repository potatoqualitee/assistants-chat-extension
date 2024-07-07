import * as vscode from 'vscode';
import { Wrapper, registerChatParticipant } from './wrapper';
import { promptForAssistant } from './assistantUtils';

let chatParticipant: vscode.ChatParticipant | undefined;
let chatParticipantCreated = false;

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

async function promptForApiProvider(configuration: vscode.WorkspaceConfiguration): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'You need to enter an API key',
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

async function updateChatParticipant(context: vscode.ExtensionContext, configuration: vscode.WorkspaceConfiguration) {
    const model = configuration.get<string>('model', 'gpt-3.5-turbo');
    const assistantId = configuration.get<string>('assistantId');
    const wrapper = await createWrapper(configuration);

    if (chatParticipant) {
        chatParticipant.dispose();
    }

    chatParticipant = await registerChatParticipant(context, wrapper, model, assistantId, configuration);
    chatParticipantCreated = true;
}

export async function activate(context: vscode.ExtensionContext) {
    console.debug('Activating Assistants Chat Extension');

    let configuration = vscode.workspace.getConfiguration('assistantsChatExtension');

    if (!configuration.get<string>('apiKey') && !configuration.get<string>('azureOpenAIApiKey')) {
        await promptForApiProvider(configuration);
        // Reload the configuration after prompting for API key
        configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
    }

    await updateChatParticipant(context, configuration);

    context.subscriptions.push(
        vscode.commands.registerCommand('assistantsChatExtension.selectAssistant', async () => {
            try {
                const wrapper = await createWrapper(configuration);
                const assistantId = await promptForAssistant(wrapper, configuration);
                if (assistantId) {
                    await configuration.update('assistantId', assistantId, vscode.ConfigurationTarget.Global);
                    // Reload the configuration after updating
                    configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
                    await updateChatParticipant(context, configuration);
                }
            } catch (err) {
                console.error('Failed to retrieve assistants:', err);
                vscode.window.showErrorMessage('Failed to retrieve assistants. Please check your network connection.');
            }
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setApiKey', async () => {
            await promptForApiKey(configuration);
            // Reload the configuration after updating
            configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
            await updateChatParticipant(context, configuration);
        }),

        vscode.commands.registerCommand('assistantsChatExtension.setAzureConfig', async () => {
            await promptForAzureConfiguration(configuration);
            // Reload the configuration after updating
            configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
            await updateChatParticipant(context, configuration);
        }),

        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension')) {
                const newConfiguration = vscode.workspace.getConfiguration('assistantsChatExtension');

                if (event.affectsConfiguration('assistantsChatExtension.apiProvider')) {
                    const oldProvider = configuration.get<string>('apiProvider');
                    const newProvider = newConfiguration.get<string>('apiProvider');

                    if (oldProvider !== newProvider && chatParticipantCreated) {
                        // Execute the /change command
                        vscode.commands.executeCommand('workbench.action.chat.execute', '/change');
                    }
                }

                configuration = newConfiguration;
                await updateChatParticipant(context, configuration);
            }
        })
    );

    console.debug('Assistants Chat Extension activated');
}

export function deactivate() {
    if (chatParticipant) {
        chatParticipant.dispose();
    }
}