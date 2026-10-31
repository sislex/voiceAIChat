import { metadataContract } from './metadata.contract.js'
import { createMemoryMetadataStore } from './metadata.js'
metadataContract(async () => ({store: createMemoryMetadataStore(), close: async () => {}}))

