# Machine Decoupling Refactor

## Problem

Agent model currently has machine-related fields directly embedded:
```prisma
model Agent {
  machineId         String?   // Hetzner machine ID
  machineIpv4       String?   // IP address
  machineSharedKey  String?   // encryption key
  machineType       String?   // 'hetzner' or 'custom'
}
```

This is wrong because:
1. `machineType` is a property of the machine, not the agent
2. Machine data is duplicated (ParkedMachine, CustomMachine, Agent all have machine fields)
3. MachineSnapshot should relate to Machine, not have machineId as a string
4. Hard to query/manage machines independently of agents

## Current State

### Models that have machine data:
1. **Agent** - has machineId, machineIpv4, machineSharedKey, machineType
2. **ParkedMachine** - pool of pre-provisioned Hetzner machines (id, machineId, machineName, ipv4, status)
3. **CustomMachine** - user-provided machines (id, ipv4, sharedKey, userId, currentAgentId)
4. **MachineHealthCheck** - health tracking (agentId, machineId)
5. **MachineSnapshot** - snapshots (machineId as string)

### Current flow:
1. ParkedMachine is created when provisioning pool
2. Agent claims ParkedMachine, copies fields (machineId, ipv4, etc.) to Agent
3. CustomMachine registered by user, linked to Agent via currentAgentId
4. Agent.machineType set to 'hetzner' or 'custom'

## Proposed Architecture

### New unified Machine model:
```prisma
model Machine {
  id            String    @id
  type          String    // 'hetzner' | 'custom'
  hetznerMachineId String? // Hetzner API ID (only for hetzner type)
  name          String?
  ipv4          String
  sharedKey     String
  port          Int       @default(8911)
  status        String    @default("offline") // launching, ready, in_use, offline

  // For custom machines
  userId        String?   // Owner (for custom machines)
  os            String?
  arch          String?
  cpuCount      Int?
  memoryGB      Int?

  // Current assignment
  currentAgentId String?  @unique
  currentAgent  Agent?    @relation(fields: [currentAgentId], references: [id], onDelete: SetNull)

  // Timestamps
  lastSeenAt    DateTime  @default(now())
  createdAt     DateTime  @default(now())

  // Relations
  snapshots     MachineSnapshot[]
  healthChecks  MachineHealthCheck[]

  @@index([type])
  @@index([status])
  @@index([userId])
}
```

### Simplified Agent model:
```prisma
model Agent {
  // ... other fields ...
  machineId     String?   // FK to Machine
  machine       Machine?  @relation(fields: [machineId], references: [id])
  // REMOVE: machineIpv4, machineSharedKey, machineType
}
```

### Updated MachineSnapshot:
```prisma
model MachineSnapshot {
  id          String    @id
  machineId   String
  machine     Machine   @relation(fields: [machineId], references: [id], onDelete: Cascade)
  // ... rest stays same
}
```

## Migration Steps

### Phase 1: Create Machine model
1. Add Machine model to schema
2. Create migration
3. Migrate existing data:
   - For each Agent with machineId/machineType='hetzner': create Machine record
   - For each CustomMachine: create Machine record with type='custom'
   - Update Agent.machineId to point to new Machine.id

### Phase 2: Update code to use Machine model
1. Create MachineRepository
2. Update AgentService to work with Machine relation
3. Update MachinePoolService to create Machine records
4. Update CustomMachineService to use Machine model
5. Update all places that read machineIpv4, machineSharedKey, machineType from Agent

### Phase 3: Remove old fields
1. Remove machineIpv4, machineSharedKey, machineType from Agent
2. Remove or merge ParkedMachine into Machine (status='launching'|'ready')
3. Remove or merge CustomMachine into Machine (type='custom')

### Phase 4: Update MachineSnapshot
1. Add proper FK relation to Machine
2. Update snapshot service to use relation

## Files to Update

### Backend:
- `prisma/schema.prisma` - schema changes
- `src/data/repositories/agent.repository.ts` - remove machine field handling
- `src/data/repositories/machine.repository.ts` - new
- `src/services/agent.service.ts` - use Machine relation
- `src/services/machinePool.service.ts` - create Machine records
- `src/services/customMachine.service.ts` - use Machine model
- `src/services/machineSnapshot.service.ts` - use Machine relation
- `src/services/claude-agent.service.ts` - get machine info from relation
- `src/api/agents/handlers.ts` - update machine info access

### Queries that access machine fields on Agent:
- Any `agent.machineId` - stays (but now FK)
- Any `agent.machineIpv4` - becomes `agent.machine.ipv4`
- Any `agent.machineSharedKey` - becomes `agent.machine.sharedKey`
- Any `agent.machineType` - becomes `agent.machine.type`

## Benefits

1. Single source of truth for machine data
2. Proper FK relationships and cascades
3. MachineSnapshot naturally relates to Machine
4. Easier to query machines independently
5. machineType is where it belongs (on Machine)
6. Can track machine lifecycle independently of agents
7. Cleaner separation of concerns

## Risks

1. Large migration with data transformation
2. Many files to update
3. Need to handle backwards compatibility during transition
4. Frontend may need updates if it accesses machine fields directly

## Questions

1. Should ParkedMachine be merged into Machine (with status for pool management)?
2. Should we keep CustomMachine separate or fully merge?
3. How to handle the transition period where both old and new code might run?
