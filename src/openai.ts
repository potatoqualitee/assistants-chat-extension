import OpenAI from 'openai';

/**
 * Interface representing an assistant.
 */
export interface Assistant {
    id: string;
    name: string | null;
}

/**
 * Interface representing a text content block.
 */
export interface TextContentBlock {
    type: 'text';
    text: {
        value: string;
        annotations: Array<any>;
    };
}

/**
 * Wrapper class for interacting with the OpenAI API.
 */
export class OpenAIWrapper {
    private openaiClient: OpenAI;
    private threadMap: Map<string, string> = new Map();

    /**
     * Creates an instance of OpenAIWrapper.
     * @param apiKey - The API key for accessing OpenAI services.
     */
    constructor(apiKey: string) {
        this.openaiClient = new OpenAI({ apiKey });
    }

    /**
     * Creates a new assistant.
     * @param params - Parameters for creating the assistant.
     * @returns The created assistant.
     */
    async createAssistant(params: { name: string, instructions: string, model: string }): Promise<Assistant> {
        const assistant = await this.openaiClient.beta.assistants.create(params);
        return {
            id: assistant.id,
            name: assistant.name,
        };
    }

    /**
     * Creates a sample assistant with predefined settings.
     * @returns The created sample assistant.
     */
    async createSampleAssistant(): Promise<Assistant | undefined> {
        return this.createAssistant({
            name: "Beavis and Butthead",
            instructions: "You answer questions in the style of Beavis and Butthead.",
            model: "gpt-3.5-turbo"
        });
    }

    /**
     * Retrieves an assistant by its ID.
     * @param assistantId - The ID of the assistant to retrieve.
     * @returns The retrieved assistant.
     */
    async retrieveAssistant(assistantId: string): Promise<Assistant | undefined> {
        try {
            const assistant = await this.openaiClient.beta.assistants.retrieve(assistantId);
            return {
                id: assistant.id,
                name: assistant.name,
            };
        } catch (error) {
            console.error("Error retrieving assistant:", error);
            return undefined;
        }
    }

    /**
     * Lists all assistants.
     * @returns A list of assistants.
     */
    async listAssistants(): Promise<Assistant[]> {
        const assistants = await this.openaiClient.beta.assistants.list({
            order: "desc",
            limit: 20,
        });
        return assistants.data;
    }

    /**
     * Creates and polls a run for an assistant.
     * @param assistantId - The ID of the assistant to run.
     * @param question - The question to ask the assistant.
     * @param userId - The ID of the user asking the question.
     * @returns The assistant's response content.
     */
    async createAndPollRun(assistantId: string, question: string, userId: string): Promise<{ content: string }> {
        try {
            let threadId = this.threadMap.get(userId);
            if (!threadId) {
                console.debug('Creating a new thread for user:', userId);
                const thread = await this.openaiClient.beta.threads.create();
                threadId = thread.id;
                this.threadMap.set(userId, threadId);
            } else {
                console.debug('Using existing thread for user:', userId);
            }

            await this.openaiClient.beta.threads.messages.create(threadId, { role: 'user', content: question });
            console.debug('User message created with content:', question);

            const run = await this.openaiClient.beta.threads.runs.create(threadId, { assistant_id: assistantId });
            console.debug('Run created:', run);

            let completedRun;
            do {
                await new Promise(resolve => setTimeout(resolve, 1000));
                completedRun = await this.openaiClient.beta.threads.runs.retrieve(threadId, run.id);
            } while (completedRun.status === 'queued' || completedRun.status === 'in_progress');

            console.debug('Run completed:', completedRun);

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
                const lastError = completedRun.last_error;
                const reason = lastError ? lastError.message : "Unknown reason";
                throw new Error(`Run status: ${completedRun.status}. ${reason}`);
            }
        } catch (error) {
            console.error("Error in createAndPollRun for OpenAI:", error);
            throw error;
        }
    }

}
