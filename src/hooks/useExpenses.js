import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useFamily } from '../context/FamilyContext'
import { useAuth } from '../context/AuthContext'

export function useExpenses() {
  const { family, members, userRole } = useFamily()
  const { user } = useAuth()
  const [expenses, setExpenses]     = useState([])
  const [loading, setLoading]       = useState(true)

  const load = useCallback(async () => {
    if (!family?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('family_id', family.id)
      .order('expense_date', { ascending: false })
      .order('created_at',   { ascending: false })
    setExpenses(data ?? [])
    setLoading(false)
  }, [family?.id])

  useEffect(() => { load() }, [load])

  // Realtime: re-fetch on any expenses or settlements change
  useEffect(() => {
    if (!family?.id) return
    const ch = supabase
      .channel(`expenses-${family.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `family_id=eq.${family.id}`,
      }, load)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expense_settlements',
        filter: `family_id=eq.${family.id}`,
      }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [family?.id, load])

  const otherParent = members.find(
    (m) => m.user_id !== user?.id && (m.role === 'parent_a' || m.role === 'parent_b')
  )

  const unsettled = expenses.filter((e) => !e.settlement_id)
  const settled   = expenses.filter((e) => !!e.settlement_id)

  // split_pct = % of the total that the NON-PAYER owes to the payer
  // positive balance = others owe me; negative = I owe others
  const balancePence = unsettled.reduce((sum, e) => {
    const owed = Math.round(e.amount_pence * e.split_pct / 100)
    return e.paid_by === user?.id ? sum + owed : sum - owed
  }, 0)

  // Default split_pct for new expenses:
  //   expense_split_pct in config = Parent A's share of costs
  //   other's share = what the non-payer owes
  const paShare      = family?.config?.expense_split_pct ?? 50
  const myShare      = userRole === 'parent_a' ? paShare : (100 - paShare)
  const otherShare   = 100 - myShare

  async function createExpense(params) {
    const { error } = await supabase.rpc('create_expense', {
      p_amount_pence: params.amount_pence,
      p_split_pct:    params.split_pct,
      p_category:     params.category,
      p_description:  params.description,
      p_expense_date: params.expense_date,
      p_paid_by_self: params.paid_by_self,
      p_child_name:   params.child_name  || null,
      p_receipt_url:  params.receipt_url || null,
    })
    if (!error) await load()
    return { error }
  }

  async function settleExpenses() {
    const { error } = await supabase.rpc('settle_expenses')
    if (!error) await load()
    return { error }
  }

  return {
    expenses, unsettled, settled, loading,
    balancePence, otherParent, myShare, otherShare,
    createExpense, settleExpenses, refetch: load,
  }
}
