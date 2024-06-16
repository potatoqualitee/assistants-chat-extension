import * as vscode from 'vscode';
import { OpenAI } from 'openai';

const GPT_ASSISTANT_COMMAND_ID = 'gpt.assistantInEditor';
const GPT_PARTICIPANT_ID = 'chat-sample.assistant';

interface IGPTChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    };
}

interface TextContentBlock {
    type: 'text';
    text: {
        value: string;
        annotations: Array<any>;
    };
}

interface Assistant {
    id: string;
    name: string | null;
}

async function promptForAssistant(client: OpenAI, configuration: vscode.WorkspaceConfiguration, stream?: vscode.ChatResponseStream): Promise<string | undefined> {
    if (stream) {
        stream.markdown('Please select an assistant.\n');
    }
    const assistants = await client.beta.assistants.list({
        order: "desc",
        limit: 20,
    });

    const assistantNames = assistants.data.map((assistant: Assistant) => assistant.name).filter((name): name is string => name !== null);
    const selectedAssistantName = await vscode.window.showQuickPick(assistantNames, {
        placeHolder: 'Select an assistant',
    });

    if (selectedAssistantName) {
        const selectedAssistant = assistants.data.find((assistant: Assistant) => assistant.name === selectedAssistantName);
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

async function registerChatParticipant(context: vscode.ExtensionContext, client: OpenAI, model: string, assistantId: string | undefined, apiKey: string, configuration: vscode.WorkspaceConfiguration) {
    const threads = client.beta.threads;
    const runs = client.beta.threads.runs;
    const messages = client.beta.threads.messages;

    const threadIdMap: { [key: string]: string } = context.globalState.get('assistantsChatExtension.threadIdMap', {});

    const getThreadId = async (assistantId: string): Promise<string> => {
        if (threadIdMap[assistantId]) {
            return threadIdMap[assistantId];
        } else {
            const thread = await threads.create();
            console.log('Thread created:', thread);
            threadIdMap[assistantId] = thread.id;
            context.globalState.update('assistantsChatExtension.threadIdMap', threadIdMap);
            return thread.id;
        }
    };

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGPTChatResult> => {
        try {
            if (!apiKey) {
                const newApiKey = await promptForApiKey(configuration);
                if (!newApiKey) {
                    return { metadata: { command: '' } };
                }
                apiKey = newApiKey;
            }

            if (!assistantId) {
                assistantId = await promptForAssistant(client, configuration, stream);
                if (!assistantId) {
                    return { metadata: { command: '' } };
                }
            }

            if (model && assistantId) {
                const threadId = await getThreadId(assistantId);
                const userMessage = request.prompt;

                const messageBody = {
                    role: 'user' as const,
                    content: userMessage,
                };

                console.log('User message:', userMessage);
                console.log('Message body sent to API:', messageBody);

                const createdMessage = await messages.create(threadId, messageBody);
                console.log('Message created:', createdMessage);

                const body = {
                    assistant_id: assistantId,
                };

                console.log('API request body:', body);

                const run = await runs.createAndPoll(threadId, body);
                console.log('Run created and polled:', run);

                const retrievedMessages = await messages.list(threadId);
                console.log('Retrieved messages:', retrievedMessages);

                const lastMessage = retrievedMessages.data.find(message => message.role === 'assistant');
                if (lastMessage) {
                    const content = lastMessage.content
                        .filter((part): part is TextContentBlock => part.type === 'text' && 'text' in part && 'value' in part.text)
                        .map(part => part.text.value)
                        .join('');
                    console.log('Assistant response content:', content);
                    stream.markdown(content);
                }
            } else {
                console.error('Model or Assistant ID is undefined. Unable to create a run.');
            }
        } catch (err) {
            handleError(err, stream, apiKey, configuration, context);
        }

        return { metadata: { command: '' } };
    };

    const gpt = vscode.chat.createChatParticipant(GPT_PARTICIPANT_ID, handler);
    gpt.iconPath = vscode.Uri.joinPath(context.extensionUri, 'cat.jpeg');

    context.subscriptions.push(
        gpt,
        vscode.commands.registerTextEditorCommand(GPT_ASSISTANT_COMMAND_ID, async (textEditor: vscode.TextEditor) => {
            const text = textEditor.document.getText();
            console.log('Editor text:', text);

            try {
                if (!apiKey) {
                    const newApiKey = await promptForApiKey(configuration);
                    if (!newApiKey) {
                        return;
                    }
                    apiKey = newApiKey;
                }

                if (!assistantId) {
                    assistantId = await promptForAssistant(client, configuration);
                    if (!assistantId) {
                        return;
                    }
                }

                if (model && assistantId) {
                    const threadId = await getThreadId(assistantId);
                    const messageBody = {
                        role: 'user' as const,
                        content: text,
                    };

                    console.log('Editor text sent as message:', text);
                    console.log('Message body sent to API:', messageBody);

                    const createdMessage = await messages.create(threadId, messageBody);
                    console.log('Message created:', createdMessage);

                    const body = {
                        assistant_id: assistantId,
                    };

                    console.log('API request body:', body);

                    const run = await runs.createAndPoll(threadId, body);
                    console.log('Run created and polled:', run);

                    const retrievedMessages = await messages.list(threadId);
                    console.log('Retrieved messages:', retrievedMessages);

                    const lastMessage = retrievedMessages.data.find(message => message.role === 'assistant');
                    if (lastMessage) {
                        const content = lastMessage.content
                            .filter((part): part is TextContentBlock => part.type === 'text' && 'text' in part && 'value' in part.text)
                            .map(part => part.text.value)
                            .join('');
                        console.log('Assistant response content:', content);
                        await textEditor.edit((edit) => {
                            const start = new vscode.Position(0, 0);
                            const end = new vscode.Position(textEditor.document.lineCount - 1, textEditor.document.lineAt(textEditor.document.lineCount - 1).text.length);
                            edit.replace(new vscode.Range(start, end), content);
                        });
                    }
                } else {
                    console.error('Model or Assistant ID is undefined. Unable to create a run.');
                }
            } catch (err) {
                handleError(err, undefined, apiKey, configuration, context);
            }
        })
    );
}

export async function activate(context: vscode.ExtensionContext) {
    const configuration = vscode.workspace.getConfiguration('assistantsChatExtension');
    const model = configuration.get<string>('model', 'gpt-3.5-turbo');
    let assistantId = configuration.get<string>('assistantId');
    let apiKey: string = configuration.get<string>('apiKey', '')!;

    if (!apiKey) {
        const setApiKey = await vscode.window.showInformationMessage('API key is missing. Please set your API key in the extension settings.', 'Set API Key');
        if (setApiKey === 'Set API Key') {
            apiKey = (await promptForApiKey(configuration))!;
            if (!apiKey) {
                // If no API key is provided, return early to prevent further execution.
                return;
            }
        } else {
            return; // If the user cancels the API key setting, return early.
        }
    }

    if (apiKey) {
        const client = new OpenAI({ apiKey });
        await registerChatParticipant(context, client, model, assistantId, apiKey, configuration);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('assistantsChatExtension.selectAssistant', async () => {
            try {
                const client = new OpenAI({ apiKey }); // Ensure client uses the updated API key
                assistantId = await promptForAssistant(client, configuration);
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
                apiKey = newApiKey; // Update the in-memory API key
                const client = new OpenAI({ apiKey: newApiKey });
                await registerChatParticipant(context, client, model, assistantId, newApiKey, configuration);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('assistantsChatExtension.apiKey')) {
                const newApiKey = configuration.get<string>('apiKey', '');
                if (newApiKey) {
                    apiKey = newApiKey; // Update the in-memory API key
                    const client = new OpenAI({ apiKey: newApiKey });
                    await registerChatParticipant(context, client, model, assistantId, newApiKey, configuration);
                    vscode.window.showInformationMessage('API key updated. Chat participant re-registered.');
                }
            }
        })
    );
}

function handleError(err: any, stream?: vscode.ChatResponseStream, apiKey?: string, configuration?: vscode.WorkspaceConfiguration, context?: vscode.ExtensionContext): void {
    if (err instanceof vscode.LanguageModelError) {
        console.log(err.message, err.code, err.cause);
        if (err.cause instanceof Error && err.cause.message.includes('Incorrect API key provided')) {
            stream?.markdown('The provided API key is incorrect. Please enter a valid API key in the extension settings.');
            stream?.markdown('To set your API key, follow these steps:\n\n1. Open the VS Code Settings (File > Preferences > Settings).\n2. Search for "Assistants Chat Extension".\n3. Enter your valid API key in the "Assistants Chat Extension: Api Key" field.\n4. Save the settings file (Ctrl+S or File > Save).\n5. You can also enter your API key via the command palette using `assistantsChatExtension.setApiKey`.');
        } else {
            stream?.markdown('An error occurred while processing your request. Please try again.');
        }
    } else {
        console.error('Unexpected error:', err);
        stream?.markdown('An unexpected error occurred. Please try again.');
    }
}

export function deactivate() { }
