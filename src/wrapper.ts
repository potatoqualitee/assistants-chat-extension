const { OpenAI } = require('openai');
const { AzureOpenAI } = require('@azure/openai-assistants');
import * as vscode from 'vscode';
import { promptForAssistant } from './assistantUtils';

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

export interface Assistant { // Ensure this is exported
    id: string;
    name: string | null;
}

export class Wrapper {
    private client: any;
    private isAzure: boolean;

    constructor(config: { apiKey: string, endpoint?: string, isAzure: boolean }) {
        this.isAzure = config.isAzure;
        if (this.isAzure) {
            this.client = new AzureOpenAI({
                api_key: config.apiKey,
                endpoint: config.endpoint,
            });
        } else {
            this.client = new OpenAI({ apiKey: config.apiKey });
        }
    }

    async listAssistants(): Promise<Assistant[]> {
        if (this.isAzure) {
            const assistants = await this.client.assistants.list({
                order: "desc",
                limit: 20,
            });
            return assistants.data;
        } else {
            const assistants = await this.client.beta.assistants.list({
                order: "desc",
                limit: 20,
            });
            return assistants.data;
        }
    }

    async getThreadId(assistantId: string): Promise<string> {
        if (this.isAzure) {
            const threads = await this.client.threads.list(assistantId);
            if (threads.data.length > 0) {
                return threads.data[0].id;
            } else {
                const newThread = await this.client.threads.create(assistantId);
                return newThread.id;
            }
        } else {
            const thread = await this.client.beta.threads.create();
            return thread.id;
        }
    }

    async createMessage(threadId: string, messageBody: any): Promise<void> {
        console.log('Sending message:', messageBody);

        if (!messageBody.content || messageBody.content.trim() === '') {
            throw new Error('Message content must be non-empty.');
        }

        if (this.isAzure) {
            await this.client.messages.create(threadId, messageBody);
        } else {
            await this.client.beta.threads.messages.create(threadId, messageBody);
        }
    }

    async createAndPollRun(threadId: string, assistantId: string): Promise<any> {
        let run;
        if (this.isAzure) {
            run = await this.client.runs.create(threadId, { assistant_id: assistantId });
            let status = run.status;
            while (status !== 'completed' && status !== 'cancelled' && status !== 'expired' && status !== 'failed') {
                await new Promise(resolve => setTimeout(resolve, 5000));
                const updatedRun = await this.client.runs.retrieve(threadId, run.id);
                status = updatedRun.status;
            }
        } else {
            await this.client.beta.threads.messages.create(threadId, { role: 'user', content: '' });
            run = await this.client.beta.threads.runs.createAndPoll(threadId, { assistant_id: assistantId });
        }
        return run;
    }

    async listMessages(threadId: string): Promise<any[]> {
        if (this.isAzure) {
            const messages = await this.client.messages.list(threadId);
            return messages.data;
        } else {
            const messages = await this.client.beta.threads.messages.list(threadId);
            return messages.data;
        }
    }
}

export async function registerChatParticipant(context: vscode.ExtensionContext, wrapper: Wrapper, model: string, assistantId: string | undefined, configuration: vscode.WorkspaceConfiguration) {
    let threadIdMap: { [key: string]: string };
    let getThreadId: (assistantId: string) => Promise<string>;

    threadIdMap = context.globalState.get('assistantsChatExtension.threadIdMap', {});

    getThreadId = async (assistantId: string): Promise<string> => {
        if (threadIdMap[assistantId]) {
            return threadIdMap[assistantId];
        } else {
            const threadId = await wrapper.getThreadId(assistantId);
            threadIdMap[assistantId] = threadId;
            context.globalState.update('assistantsChatExtension.threadIdMap', threadIdMap);
            return threadId;
        }
    };

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<IGPTChatResult> => {
        try {
            if (request.command === 'change') {
                const newAssistantId = await promptForAssistant(wrapper, configuration, stream);
                if (newAssistantId) {
                    assistantId = newAssistantId;
                    const assistants = await wrapper.listAssistants();
                    const selectedAssistant = assistants.find((assistant: Assistant) => assistant.id === assistantId);
                    if (selectedAssistant && selectedAssistant.name) {
                        stream.markdown(`You have switched to the assistant: **${selectedAssistant.name}**. How can I assist you today?`);
                    } else {
                        stream.markdown(`You have switched to the assistant with ID: **${assistantId}**. How can I assist you today?`);
                    }
                } else {
                    stream.markdown('No assistant selected. Please try again.');
                }
                return { metadata: { command: 'change' } };
            }

            if (!assistantId) {
                assistantId = await promptForAssistant(wrapper, configuration, stream);
                if (!assistantId) {
                    return { metadata: { command: '' } };
                }
            }

            if (model && assistantId) {
                const threadId = await getThreadId(assistantId);
                const userMessage = request.prompt;

                if (userMessage.trim() === '') {
                    stream.markdown('Please enter a non-empty message.');
                    return { metadata: { command: '' } };
                }

                const messageBody = {
                    role: 'user' as const,
                    content: userMessage,
                };

                console.log('User message:', userMessage);
                console.log('Message body sent to API:', messageBody);

                await wrapper.createMessage(threadId, messageBody);
                const run = await wrapper.createAndPollRun(threadId, assistantId);

                console.log('Run created and polled:', run);

                const retrievedMessages = await wrapper.listMessages(threadId);
                console.log('Retrieved messages:', retrievedMessages);

                const lastMessage = retrievedMessages.find((message: any) => message.role === 'assistant');
                if (lastMessage) {
                    const content = lastMessage.content
                        .filter((part: any): part is TextContentBlock => part.type === 'text' && 'text' in part && 'value' in part.text)
                        .map((part: any) => part.text.value)
                        .join('');
                    console.log('Assistant response content:', content);
                    stream.markdown(content);
                }
            } else {
                console.error('Model or Assistant ID is undefined. Unable to create a run.');
            }
        } catch (err) {
            handleError(err, stream, configuration, context);
        }

        return { metadata: { command: '' } };
    };

    const gpt = vscode.chat.createChatParticipant('chat-sample.assistant', handler);
    gpt.iconPath = vscode.Uri.joinPath(context.extensionUri, 'cat.jpeg');

    context.subscriptions.push(
        gpt,
        vscode.commands.registerTextEditorCommand('gpt.assistantInEditor', async (textEditor: vscode.TextEditor) => {
            const text = textEditor.document.getText();
            console.log('Editor text:', text);

            try {
                if (!assistantId) {
                    assistantId = await promptForAssistant(wrapper, configuration);
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

                    await wrapper.createMessage(threadId, messageBody);
                    const run = await wrapper.createAndPollRun(threadId, assistantId);

                    console.log('Run created and polled:', run);

                    const retrievedMessages = await wrapper.listMessages(threadId);
                    console.log('Retrieved messages:', retrievedMessages);

                    const lastMessage = retrievedMessages.find((message: any) => message.role === 'assistant');
                    if (lastMessage) {
                        const content = lastMessage.content
                            .filter((part: any): part is TextContentBlock => part.type === 'text' && 'text' in part && 'value' in part.text)
                            .map((part: any) => part.text.value)
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
                handleError(err, undefined, configuration, context);
            }
        })
    );
}

function handleError(err: any, stream?: vscode.ChatResponseStream, configuration?: vscode.WorkspaceConfiguration, context?: vscode.ExtensionContext): void {
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
