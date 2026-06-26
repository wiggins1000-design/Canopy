-- Fix missing school names for schools where term dates were successfully scraped
-- but Claude could not identify the name from the page content.
UPDATE public.school_calendars SET school_name = 'Cotham School'
  WHERE homepage_url = 'https://www.cotham.bristol.sch.uk' AND school_name IS NULL;

UPDATE public.school_calendars SET school_name = 'St Mary Redcliffe and Temple School'
  WHERE homepage_url = 'https://www.smrt.bristol.sch.uk' AND school_name IS NULL;
