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

export const callAssistant = async (endpoint, apiKey, assistantId, question, cb) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    console.log({ assistantId, question });

    try {
        if (!assistantId) {
            throw new Error("Assistant ID is required.");
        }

        const assistant = await assistantsClient.getAssistant(assistantId);
        const assistantThread = await assistantsClient.createThread();

        await assistantsClient.createMessage(assistantThread.id, "user", question);

        let runResponse = await assistantsClient.createRun(assistantThread.id, {
            assistantId: assistantId,
            instructions: question
        });

    cb(null, "Agent activated");
    do {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        runResponse = await assistantsClient.getRun(assistantThread.id, runResponse.id);
        cb(null, "Agent Running", runResponse);
    } while (runResponse.status === "queued" || runResponse.status === "in_progress");

    const runMessages = await assistantsClient.listMessages(assistantThread.id);
    for (const runMessageDatum of runMessages.data) {
        for (const item of runMessageDatum.content) {
            if (item.type === "text") {
                cb(null, "text returned", item.text);
            } else if (item.type === "image_file") {
                cb(null, "image created", item);
                const imageId = item.imageFile.fileId;
                console.log({ imageId });
                const file = await assistantsClient.getFile(imageId);
                console.log({ file });
            }
        }
    }
} catch (error) {
    if (error.statusCode === 401) {
        console.error("Authentication error. Please check your API key and endpoint.");
    } else {
        console.error("Error calling assistant:", error);
    }
    cb(error, "Error calling assistant");
}
};