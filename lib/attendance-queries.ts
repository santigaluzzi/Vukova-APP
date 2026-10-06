// Reuse identical identity resolution for details and aggregates. Explicit
// employee links take priority over corrected spellings and unique roster names.
export const attendanceIdentity = "COALESCE(bl.member_id,l.member_id,n.member_id,r.member_id,o.member_id)";
// Queries using this join must include sheet_imports i for the source branch.
export const attendanceJoins = `LEFT JOIN sheet_branch_name_links bl ON bl.branch_id=i.branch_id AND bl.normalized_name=a.normalized_name
  LEFT JOIN sheet_name_links l ON i.branch_id='branch-acassuso' AND l.normalized_name=a.normalized_name
  LEFT JOIN sheet_member_aliases n ON i.branch_id='branch-acassuso' AND n.normalized_name=a.normalized_name
  LEFT JOIN (SELECT sr.normalized_name,m.home_branch_id AS branch_id,
    CASE WHEN COUNT(*)=1 THEN MIN(sr.member_id) END AS member_id
    FROM sheet_rosters sr JOIN members m ON m.id=sr.member_id WHERE sr.service='gym' AND sr.archived_at IS NULL
    GROUP BY sr.normalized_name,m.home_branch_id) r ON r.normalized_name=a.normalized_name AND r.branch_id=i.branch_id
  LEFT JOIN (SELECT sr.normalized_name,CASE WHEN COUNT(*)=1 THEN MIN(sr.member_id) END AS member_id
    FROM sheet_rosters sr WHERE sr.service='gym' AND sr.archived_at IS NULL GROUP BY sr.normalized_name) o ON o.normalized_name=a.normalized_name`;
