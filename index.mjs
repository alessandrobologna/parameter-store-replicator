import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand, GetParameterHistoryCommand } from "@aws-sdk/client-ssm";

const sourceSSM = new SSMClient({
    region: process.env.AWS_DEFAULT_REGION
});
const targetSSM = new SSMClient({
    region: process.env.AWS_TARGET_REGION
});

const checkTarget = async (event) => {
    try {
        // check if target exists already
        const command = new GetParameterCommand({ Name: event.detail.name, WithDecryption: event.detail.type == "SecureString" });
        const targetParam = await targetSSM.send(command);
        return targetParam;
    } catch (error) {
        // we will consider a ParameterNotFound response from the target a non error
        if (error.__type == 'ParameterNotFound') {
            return null;
        } else {
            throw error;
        }
    }
};

const update = async (event) => {
    const command = new GetParameterHistoryCommand({ Name: event.detail.name, WithDecryption: event.detail.type == "SecureString" });
    const sourceParamList = await sourceSSM.send(command);
    const sourceParam = sourceParamList.Parameters.at(-1);
    const targetParam = await checkTarget(event);
    if (!targetParam || targetParam.Parameter.Value !== sourceParam.Value || targetParam.Parameter.Type !== sourceParam.Type) {
        const command = new PutParameterCommand({
            Overwrite: true,
            Name: sourceParam.Name,
            Value: sourceParam.Value,
            Tier: sourceParam.Tier,
            Type: sourceParam.Type
        });
        const response = await targetSSM.send(command);
        return response;
    } else {
        console.log(`Parameter ${event.detail.name} is already in ${process.env.AWS_TARGET_REGION} with the same value and type, ignoring`);
        return null;
    }
};


const remove = async (event) => {
    try {
        const command = new DeleteParameterCommand({ Name: event.detail.name });
        const response = await targetSSM.send(command);
        return response;
    } catch (error) {
        // we will consider a ParameterNotFound response from the target a non error
        if (error.__type == 'ParameterNotFound') {
            return null;
        } else {
            throw error;
        }
    }
};

const operations = {
    Create: 'update',
    Update: 'update',
    Delete: 'remove'
};

export const handler = async (event, context, callback) => {
    console.log(JSON.stringify(event));
    try {
        if (event.detail.operation in operations) {
            let success;
            switch (event.detail.operation) {
                case "Create":
                case "Update":
                    success = await update(event);
                    break;
                case "Delete":
                    success = await remove(event);
            }
            if (success) {
                console.log(`${event.detail.operation} result:\n${JSON.stringify(success)}`);
            }
        } else {
            console.log(`Unknown operation "${event.detail.operation}":\n ${JSON.stringify(event)}`);
        }
    } catch (error) {
        console.log(`Operation failed for\n ${JSON.stringify(event)}\n${JSON.stringify(error)}`);
        if (error.retryable) {
            return callback(error);
        }
    }
    return callback(null, 'OK');
};
