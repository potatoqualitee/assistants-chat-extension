import OpenAI from 'openai';

export interface Assistant {
    id: string;
    name: string | null;
}

export interface TextContentBlock {
    type: 'text';
    text: {
        value: string;
        annotations: Array<any>;
    };
}

export class OpenAIWrapper {
    private openaiClient: OpenAI;
    private threadMap: Map<string, string> = new Map();

    constructor(apiKey: string) {
        this.openaiClient = new OpenAI({ apiKey });
    }

    async listAssistants(): Promise<Assistant[]> {
        const assistants = await this.openaiClient.beta.assistants.list({
            order: "desc",
            limit: 20,
        });
        return assistants.data;
    }

    async createAndPollRun(assistantId: string, question: string, userId: string): Promise<{ content: string }> {
        try {
            let threadId = this.threadMap.get(userId);
            if (!threadId) {
                console.log('Creating a new thread for user:', userId);
                const thread = await this.openaiClient.beta.threads.create();
                threadId = thread.id;
                this.threadMap.set(userId, threadId);
            } else {
                console.log('Using existing thread for user:', userId);
            }

            await this.openaiClient.beta.threads.messages.create(threadId, { role: 'user', content: question });
            console.log('User message created with content:', question);

            const run = await this.openaiClient.beta.threads.runs.create(threadId, { assistant_id: assistantId });
            console.log('Run created:', run);

            let completedRun;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000));
                completedRun = await this.openaiClient.beta.threads.runs.retrieve(threadId, run.id);
            } while (completedRun.status === 'queued' || completedRun.status === 'in_progress');

            console.log('Run completed:', completedRun);

            if (completedRun.status === 'completed') {
                const messages = await this.openaiClient.beta.threads.messages.list(threadId);
                const assistantMessage = messages.data.find(msg => msg.role === 'assistant' && msg.run_id === run.id);

                if (assistantMessage && assistantMessage.content && Array.isArray(assistantMessage.content)) {
                    const content = assistantMessage.content
                        .filter((part: any): part is TextContentBlock => part.type === 'text')
                        .map((part: TextContentBlock) => part.text.value)
                        .join('');
                    return { content };
                } else {
                    throw new Error('Unexpected structure of assistant message');
                }
            } else {
                throw new Error(`Run failed with status: ${completedRun.status}`);
            }
        } catch (error) {
            console.error("Error in createAndPollRun for OpenAI:", error);
            throw error;
        }
    }
}