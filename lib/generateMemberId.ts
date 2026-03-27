import { Counter } from '@/models/Counter'
import { Member } from '@/models/Member'
import { EntertainmentMember } from '@/models/EntertainmentMember'

const MAX_RETRIES = 10;

export async function generateMemberId(poolId: string, isEntertainment: boolean = false): Promise<string> {
  const counterId = isEntertainment ? `entertainmentMemberId_${poolId}` : `memberId_${poolId}`
  const prefix = isEntertainment ? 'MS' : 'M'
  const Model = isEntertainment ? EntertainmentMember : Member

  // ── Seed counter if it doesn't exist yet ─────────────────────────────
  const existing = await Counter.findById(counterId)

  if (!existing) {
    // Find the highest existing numeric ID in this pool to seed the counter
    const lastMember = await (Model as any)
      .findOne({ poolId, memberId: { $regex: `^${prefix}\\d+$` } })
      .sort({ memberId: -1 })
      .select('memberId')
      .lean()

    let startSeq = 0
    if (lastMember?.memberId) {
      const num = parseInt(lastMember.memberId.replace(prefix, ''), 10)
      if (!isNaN(num)) startSeq = num
    }

    // Use upsert to avoid race condition where two requests both try to create
    await Counter.findByIdAndUpdate(
      counterId,
      { $setOnInsert: { seq: startSeq } },
      { upsert: true, new: true }
    )
  }

  // ── Self-healing retry loop ──────────────────────────────────────────
  // Increment counter atomically, then verify the generated ID doesn't
  // already exist in the collection. If it does (counter was out of sync),
  // loop again — the next increment will try the next number.
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const counter = await Counter.findByIdAndUpdate(
      counterId,
      { $inc: { seq: 1 } },
      { new: true }
    )

    const candidateId = `${prefix}${String(counter.seq).padStart(4, '0')}`

    // Quick existence check — uses the compound index (poolId, memberId)
    const alreadyExists = await (Model as any).exists({ poolId, memberId: candidateId })

    if (!alreadyExists) {
      return candidateId // Safe to use
    }

    // ID already taken (counter was behind) — loop will increment and try next
    console.warn(`[generateMemberId] Collision detected: ${candidateId} already exists in pool ${poolId}, retrying (${attempt + 1}/${MAX_RETRIES})`)
  }

  // Fallback: should never happen, but if it does, throw a clear error
  throw new Error(`Failed to generate a unique member ID for pool ${poolId} after ${MAX_RETRIES} attempts. Please check the Counter collection.`)
}
