-- Silent autosave for the parenting plan tool: updates plan_data on navigation
-- (e.g. switching tabs) without creating a new pp_versions row, unlike
-- pp_save_version which is reserved for deliberate "Submit draft"/"Save & share"
-- actions the other collaborator sees in Draft history.
CREATE OR REPLACE FUNCTION public.pp_autosave_plan(
  p_plan_id   uuid,
  p_plan_data jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.pp_is_collaborator(p_plan_id) THEN
    RAISE EXCEPTION 'not a collaborator';
  END IF;

  UPDATE public.pp_plans
  SET plan_data  = p_plan_data,
      updated_at = now()
  WHERE id = p_plan_id;

  RETURN FOUND;
END;
$$;
