const HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || 'http://127.0.0.1:8888'
const HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY || ''
const MEMORY_BANK_NAME = 'word-gpt-plus'
const MEMORY_BANK_BACKGROUND = 'Word GPT+ add-in workspace memory for retain, recall, and reflect operations'

function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (HINDSIGHT_API_KEY) {
    headers.Authorization = `Bearer ${HINDSIGHT_API_KEY}`
  }
  return headers
}

async function request(path, options = {}) {
  const url = `${HINDSIGHT_BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Hindsight API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return await response.json()
}

async function provisionMemoryBank() {
  console.log(`[Provision] Connecting to Hindsight at ${HINDSIGHT_BASE_URL}`)

  // First, check health
  try {
    const health = await request('/health', { method: 'GET' })
    console.log(`[Provision] Health check:`, health)
  } catch (error) {
    console.error(`[Provision] Health check failed:`, error)
    throw new Error(`Cannot connect to Hindsight at ${HINDSIGHT_BASE_URL}`)
  }

  // List existing banks to see if ours exists
  let existingBanks = []
  try {
    const banksResponse = await request('/v1/default/banks', { method: 'GET' })
    existingBanks = banksResponse.banks || []
    console.log(`[Provision] Existing banks:`, existingBanks.map(b => `${b.id} (${b.name})`).join(', ') || 'none')
  } catch (error) {
    console.error(`[Provision] Failed to list banks:`, error)
    throw new Error(`Failed to list existing banks`)
  }

  // Check if our bank already exists
  const existingBank = existingBanks.find(b => b.name === MEMORY_BANK_NAME)
  if (existingBank) {
    console.log(`[Provision] Bank "${MEMORY_BANK_NAME}" already exists with ID: ${existingBank.id}`)
    return { bankId: existingBank.id, bank: existingBank }
  }

  // Create new memory bank
  console.log(`[Provision] Creating memory bank "${MEMORY_BANK_NAME}"...`)
  try {
    const newBank = await request(`/v1/default/banks/${encodeURIComponent(MEMORY_BANK_NAME)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: MEMORY_BANK_NAME, background: MEMORY_BANK_BACKGROUND }),
    })
    console.log(`[Provision] Created bank:`, newBank)
    return { bankId: newBank.bank_id || newBank.id || MEMORY_BANK_NAME, bank: newBank }
  } catch (error) {
    console.error(`[Provision] Failed to create bank:`, error)
    throw new Error(`Failed to create memory bank: ${error}`)
  }
}

async function testMemoryBank(bankId) {
  console.log(`[Provision] Testing memory bank ${bankId}...`)

  // Test retain
  console.log(`[Provision] Testing retain...`)
  const retainResult = await request(`/v1/default/banks/${encodeURIComponent(bankId)}/memories`, {
    method: 'POST',
    body: JSON.stringify({
      items: [
        {
          content: 'Test memory from provisioning script',
          context: 'provisioning test',
          document_id: 'provisioning-test-1',
          tags: ['test', 'provisioning'],
        },
      ],
      async: false,
    }),
  })
  console.log(`[Provision] Retain result:`, retainResult)

  // Test recall
  console.log(`[Provision] Testing recall...`)
  const recallResult = await request(`/v1/default/banks/${encodeURIComponent(bankId)}/memories/recall`, {
    method: 'POST',
    body: JSON.stringify({
      query: 'provisioning test memory',
      budget: 'low',
      max_tokens: 100,
    }),
  })
  console.log(`[Provision] Recall result:`, JSON.stringify(recallResult, null, 2))

  // Test reflect
  console.log(`[Provision] Testing reflect...`)
  const reflectResult = await request(`/v1/default/banks/${encodeURIComponent(bankId)}/reflect`, {
    method: 'POST',
    body: JSON.stringify({
      query: 'What was the test memory about?',
      budget: 'low',
      max_tokens: 100,
    }),
  })
  console.log(`[Provision] Reflect result:`, JSON.stringify(reflectResult, null, 2))

  console.log(`[Provision] All tests passed!`)
}

async function main() {
  console.log('='.repeat(60))
  console.log('Hindsight Memory Bank Provisioning for word-gpt-plus')
  console.log('='.repeat(60))

  try {
    const { bankId, bank } = await provisionMemoryBank()

    console.log('')
    console.log('='.repeat(60))
    console.log('PROVISIONING COMPLETE')
    console.log('='.repeat(60))
    console.log(`Memory Bank ID: ${bankId}`)
    console.log(`Memory Bank Name: ${bank.name}`)
    console.log(`Memory Bank Background: ${bank.background}`)
    console.log('')

    console.log('DEFAULT_HINDSIGHT_CONFIG should use:')
    console.log(`  hindsightMemoryBankId: '${bankId}'`)
    console.log('')

    // Run tests
    await testMemoryBank(bankId)

    console.log('')
    console.log('='.repeat(60))
    console.log('ALL DONE!')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('Provisioning failed:', error)
    process.exit(1)
  }
}

main()
