import { AssistantsClient, AzureKeyCredential } from "@azure/openai-assistants";
import { setLogLevel } from "@azure/logger";
setLogLevel("info");

export const listAssistants = async (endpoint, apiKey) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    const assistants = (await assistantsClient.listAssistants()).data.map(d => {
        return {
            id: d.id, name: d.name, instructions: d.instructions
        };
    });
    return assistants;
};

export const callAssistant = async (endpoint, apiKey, assistantId, question) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    console.log('callAssistant called with:', { assistantId, question });

    try {
        if (!assistantId) {
            throw new Error("Assistant ID is required.");
        }

        // Create a thread
        const assistantThread = await assistantsClient.createThread();

        // Create a message in the thread
        await assistantsClient.createMessage(assistantThread.id, "user", question);

        // Create and start a run
        let runResponse = await assistantsClient.createRun(assistantThread.id, {
            assistantId: assistantId
        });

        // Poll for completion
        do {
            await new Promise((resolve) => setTimeout(resolve, 800));
            runResponse = await assistantsClient.getRun(assistantThread.id, runResponse.id);
        } while (runResponse.status === "queued" || runResponse.status === "in_progress");

        if (runResponse.status === "completed") {
            const runMessages = await assistantsClient.listMessages(assistantThread.id);
            let assistantResponse = "";
            for (const runMessageDatum of runMessages.data) {
                if (runMessageDatum.role === "assistant") {
                    for (const item of runMessageDatum.content) {
                        if (item.type === "text") {
                            assistantResponse += item.text.value + "\n";
                        }
                    }
                }
            }
            return assistantResponse.trim();
        } else {
            throw new Error(`Run failed with status: ${runResponse.status}`);
        }

    } catch (error) {
        console.error("Error calling assistant:", error);
        throw error;
    }
};