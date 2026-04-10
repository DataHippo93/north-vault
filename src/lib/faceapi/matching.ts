import type { SupabaseClient } from '@supabase/supabase-js'

const SIMILARITY_THRESHOLD = 0.6

/**
 * Find an existing person matching the given face embedding,
 * or create a new person if no match is found.
 * Returns the person_id.
 */
export async function findOrCreatePerson(embedding: number[], supabase: SupabaseClient): Promise<string> {
  // Format embedding as pgvector string: [0.1,0.2,...]
  const embeddingStr = `[${embedding.join(',')}]`

  // Try to find an existing person via cosine similarity
  const { data: matches } = await supabase.schema('northvault').rpc('match_face', {
    query_embedding: embeddingStr,
    similarity_threshold: SIMILARITY_THRESHOLD,
    max_results: 1,
  })

  if (matches && matches.length > 0) {
    const personId = matches[0].person_id as string

    // Increment face count
    await supabase
      .schema('northvault')
      .from('persons')
      .update({ face_count: (matches[0].face_count ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', personId)

    return personId
  }

  // No match — create a new person
  const { data: newPerson, error } = await supabase
    .schema('northvault')
    .from('persons')
    .insert({ face_count: 1 })
    .select('id')
    .single()

  if (error || !newPerson) {
    throw new Error(`Failed to create person: ${error?.message}`)
  }

  return newPerson.id as string
}

/**
 * Update the representative face for a person (pick the highest-confidence detection).
 */
export async function updateRepresentativeFace(personId: string, supabase: SupabaseClient): Promise<void> {
  const { data: bestFace } = await supabase
    .schema('northvault')
    .from('faces')
    .select('id')
    .eq('person_id', personId)
    .order('confidence', { ascending: false })
    .limit(1)
    .single()

  if (bestFace) {
    await supabase
      .schema('northvault')
      .from('persons')
      .update({ representative_face_id: bestFace.id })
      .eq('id', personId)
  }
}
