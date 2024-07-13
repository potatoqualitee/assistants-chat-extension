import { AssistantsClient, AzureKeyCredential } from "@azure/openai-assistants";

/**
 * Creates an Azure Assistant.
 * @param endpoint - The endpoint URL for Azure OpenAI services.
 * @param apiKey - The API key for accessing Azure OpenAI services.
 * @param params - Parameters for creating the assistant.
 * @returns The created assistant.
 */
export const createAzureAssistant = async (endpoint, apiKey, params) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    const assistant = await assistantsClient.createAssistant(params);
    return {
        id: assistant.id,
        name: assistant.name,
    };
};

/**
 * Lists all Azure Assistants.
 * @param endpoint - The endpoint URL for Azure OpenAI services.
 * @param apiKey - The API key for accessing Azure OpenAI services.
 * @returns A list of assistants.
 */
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

/**
 * Calls an Azure Assistant.
 * @param endpoint - The endpoint URL for Azure OpenAI services.
 * @param apiKey - The API key for accessing Azure OpenAI services.
 * @param assistantId - The ID of the assistant to call.
 * @param question - The question to ask the assistant.
 * @param userId - The ID of the user asking the question.
 * @returns The assistant's response content.
 */
export const callAssistant = async (endpoint, apiKey, assistantId, question, userId) => {
    const assistantsClient = new AssistantsClient(endpoint, new AzureKeyCredential(apiKey));
    console.debug('callAssistant called with:', { assistantId, question, userId });

    try {
        if (!assistantId) {
            throw new Error("Assistant ID is required.");
        }

        let threadId = threadMap.get(userId);
        if (!threadId) {
            console.debug('Creating a new thread for user:', userId);
            const thread = await assistantsClient.createThread();
            threadId = thread.id;
            threadMap.set(userId, threadId);
        } else {
            console.debug('Using existing thread for user:', userId);
        }

        console.debug('Creating a message in thread:', threadId);
        await assistantsClient.createMessage(threadId, "user", question);

        console.debug('Creating and starting a run');
        let runResponse = await assistantsClient.createRun(threadId, { assistantId });

        console.debug('Polling for run completion');
        while (runResponse.status === "queued" || runResponse.status === "in_progress") {
            await new Promise((resolve) => setTimeout(resolve, 800));
            runResponse = await assistantsClient.getRun(threadId, runResponse.id);
        }

        if (runResponse.status === "completed") {
            console.debug('Run completed, retrieving messages');
            const runMessages = await assistantsClient.listMessages(threadId);
            console.debug('Retrieved messages:', runMessages.data);

            const assistantMessages = runMessages.data
                .filter(msg => msg.role === "assistant" && msg.runId === runResponse.id);

            console.debug('Filtered assistant messages:', assistantMessages);

            const responseContent = assistantMessages.flatMap(msg => msg.content);

            console.debug('Combined response content:', responseContent);

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
            const lastError = runResponse.last_error;
            const failedAt = runResponse.failed_at;
            const reason = lastError ? lastError.message : "Unknown reason";
            throw new Error(`Run status: ${completedRun.status}. ${reason}`);
        }

    } catch (error) {
        let errorMessage = "Error calling assistant.";
        if (error instanceof Error) {
            errorMessage += ` Error message: ${error.message}`;
        } else {
            errorMessage += " An unknown error occurred.";
        }
        console.error(errorMessage, error);
        throw new Error(errorMessage);
    }
};


/**
 * Creates a sample Azure Assistant.
 * @param azureEndpoint - The endpoint URL for Azure OpenAI services.
 * @param azureApiKey - The API key for accessing Azure OpenAI services.
 * @returns The created sample assistant.
 */
export async function createSampleAzureAssistant(azureEndpoint, azureApiKey) {
    const defaultDeploymentNames = ["gpt-4o", "gpt-3.5-turbo", "gpt-4"];

    for (const deploymentName of defaultDeploymentNames) {
        try {
            const assistant = await createAzureAssistant(azureEndpoint, azureApiKey, {
                model: deploymentName,
                name: "Beavis and Butthead",
                instructions: "You answer questions in the style of Beavis and Butthead."
            });
            return assistant;
        } catch (error) {
            console.error(`Failed to create assistant with deployment name '${deploymentName}':`, error);
        }
    }

    const customDeploymentName = await vscode.window.showInputBox({
        prompt: "Please provide your Azure OpenAI deployment name:",
        placeHolder: "Enter deployment name"
    });

    if (customDeploymentName) {
        try {
            const assistant = await createAzureAssistant(azureEndpoint, azureApiKey, {
                model: customDeploymentName,
                name: "Beavis and Butthead",
                instructions: "You answer questions in the style of Beavis and Butthead."
            });
            return assistant;
        } catch (error) {
            console.error(`Failed to create assistant with custom deployment name '${customDeploymentName}':`, error);
            vscode.window.showErrorMessage(`Failed to create assistant with custom deployment name '${customDeploymentName}'. Please check your deployment name and try again.`);
        }
    } else {
        vscode.window.showWarningMessage("No deployment name provided. Sample assistant creation skipped.");
    }
}
