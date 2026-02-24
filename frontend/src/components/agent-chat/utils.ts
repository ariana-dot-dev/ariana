import {AgentState} from "../../../../backend/shared/types";


export function agentStateToString(state: AgentState): string {
    switch (state) {
        case AgentState.PROVISIONING: return 'Provisioning';
        case AgentState.PROVISIONED: return 'Installing';
        case AgentState.CLONING: return 'Configuring';
        case AgentState.READY: return 'Ready';
        case AgentState.RUNNING: return 'Working';
        case AgentState.IDLE: return 'Idle';
        case AgentState.ARCHIVING: return 'Stopping';
        case AgentState.ARCHIVED: return 'Stopped';
        case AgentState.ERROR: return 'Error';
    }
}


export function describeAgentState(
    state: AgentState,
    uploadProgress?: { loaded: number; total: number; percentage: number; isFullBundle?: boolean } | null
): string | null {
    switch (state) {
        case AgentState.PROVISIONING: return 'Creating virtual machine...';
        case AgentState.PROVISIONED: {
            if (uploadProgress) {
                const sizeMB = (uploadProgress.total / (1024 * 1024)).toFixed(1);
                let message = `Uploading project... ${uploadProgress.percentage}% (${sizeMB} MB) • Keep app open`;

                // Add hint about GitHub access for large full bundle uploads
                if (uploadProgress.isFullBundle && uploadProgress.total > 10 * 1024 * 1024) { // > 10MB
                    message += '\nTip: Sign in with GitHub for ~100x smaller uploads';
                }

                return message;
            }
            return 'Setting up disk';
        }
        case AgentState.CLONING: return 'Initializing Claude Code environment...';
        case AgentState.ARCHIVING: return 'Saving snapshot and stopping...';
        default: return null;
    }
}


export function getAgentStatusColor(state: AgentState): string {
    switch (state) {
        case AgentState.PROVISIONING: return 'text-chart-1'
        case AgentState.PROVISIONED: return 'text-chart-2'
        case AgentState.CLONING: return 'text-chart-4'
        case AgentState.READY: return  'text-constructive-foreground/80'
        case AgentState.IDLE: return 'text-constructive-foreground/80'
        case AgentState.RUNNING: return 'text-accent'
        case AgentState.ERROR: return 'text-destructive-foreground/80'
        case AgentState.ARCHIVING: return 'text-chart-3'
        case AgentState.ARCHIVED: return 'text-muted-foreground/70'
    }
}

export function getAgentStatusBgColor(state: AgentState): string {
    switch (state) {
        case AgentState.PROVISIONING: return 'bg-chart-1'
        case AgentState.PROVISIONED: return 'bg-chart-2'
        case AgentState.CLONING: return 'bg-chart-4'
        case AgentState.READY: return  'bg-constructive-foreground/80'
        case AgentState.IDLE: return 'bg-constructive-foreground/80'
        case AgentState.RUNNING: return 'bg-accent'
        case AgentState.ERROR: return 'bg-destructive'
        case AgentState.ARCHIVING: return 'bg-chart-3'
        case AgentState.ARCHIVED: return 'bg-muted-foreground/70'
    }
}
