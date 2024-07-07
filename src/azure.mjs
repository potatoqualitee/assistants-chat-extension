import { AssistantsClient, AzureKeyCredential } from "@azure/openai-assistants";
//import { setLogLevel } from "@azure/logger";
//setLogLevel("info");

export const listAssistants = async (endpoint, apiKey) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    const assistants = (await assistantsClient.listAssistants()).data.map(d => {
        return {
            id: d.id, name: d.name, instructions: d.instructions
        };
    });
    return assistants;
};

const threadMap = new Map();

export const callAssistant = async (endpoint, apiKey, assistantId, question, userId) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    console.debug('callAssistant called with:', { assistantId, question, userId });

    try {
        if (!assistantId) {
            throw new Error("Assistant ID is required.");
        }

        // Get or create a thread for this user
        let threadId = threadMap.get(userId);
        if (!threadId) {
            console.debug('Creating a new thread for user:', userId);
            const thread = await assistantsClient.createThread();
            threadId = thread.id;
            threadMap.set(userId, threadId);
        } else {
            console.debug('Using existing thread for user:', userId);
        }

        // Create a message in the thread
        console.debug('Creating a message in thread:', threadId);
        await assistantsClient.createMessage(threadId, "user", question);

        // Create and start a run
        console.debug('Creating and starting a run');
        let runResponse = await assistantsClient.createRun(threadId, {
            assistantId: assistantId
        });

        // Poll for completion
        console.debug('Polling for run completion');
        while (runResponse.status === "queued" || runResponse.status === "in_progress") {
            await new Promise((resolve) => setTimeout(resolve, 800));
            runResponse = await assistantsClient.getRun(threadId, runResponse.id);
        }

        if (runResponse.status === "completed") {
            console.debug('Run completed, retrieving messages');
            const runMessages = await assistantsClient.listMessages(threadId);
            console.debug('Retrieved messages:', runMessages.data);

            // Get only the assistant messages generated during the current run
            const assistantMessages = runMessages.data
                .filter(msg => msg.role === "assistant" && msg.runId === runResponse.id);

            console.debug('Filtered assistant messages:', assistantMessages);

            // Combine the content of all assistant messages
            const responseContent = assistantMessages.flatMap(msg => msg.content);

            console.debug('Combined response content:', responseContent);

            // Extract and concatenate the text content
            const textContent = responseContent
                .filter(item => item.type === "text")
                .map(item => item.text.value)
                .join("\n");

            console.debug('Extracted text content:', textContent);

            if (textContent.trim() !== "") {
                return textContent;
            } else {
                return "No response from the assistant.";
            }
        } else {
            throw new Error(`Run failed with status: ${runResponse.status}`);
        }

    } catch (error) {
        console.error("Error calling assistant:", error);
        throw error;
    }
};