delete from oauth_access_token
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
)
or client_id in (
  select client_id from oauth_client
  where name in (
    'OpenMemory Live E2E',
    'OpenMemory Live Full Smoke',
    'OpenMemory Screenshot MCP'
  )
);

delete from oauth_refresh_token
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
)
or client_id in (
  select client_id from oauth_client
  where name in (
    'OpenMemory Live E2E',
    'OpenMemory Live Full Smoke',
    'OpenMemory Screenshot MCP'
  )
);

delete from oauth_consent
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
)
or client_id in (
  select client_id from oauth_client
  where name in (
    'OpenMemory Live E2E',
    'OpenMemory Live Full Smoke',
    'OpenMemory Screenshot MCP'
  )
);

delete from oauth_client
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
)
or name in (
  'OpenMemory Live E2E',
  'OpenMemory Live Full Smoke',
  'OpenMemory Screenshot MCP'
);

delete from session
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
);

delete from account
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
);

delete from workspace_member
where user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
)
or email like 'live-e2e-%@example.com'
or email like 'live-full-%@example.com'
or email like 'ui-e2e-%@example.com'
or email like 'ui-invite-%@example.com'
or email like 'ui-shot-%@example.com'
or email like 'live-probe-%@example.com'
or email like 'live-vector-probe-%@example.com';

delete from workspace
where owner_user_id in (
  select id from user
  where email like 'live-e2e-%@example.com'
    or email like 'live-full-%@example.com'
    or email like 'ui-e2e-%@example.com'
    or email like 'ui-invite-%@example.com'
    or email like 'ui-shot-%@example.com'
    or email like 'live-probe-%@example.com'
    or email like 'live-vector-probe-%@example.com'
);

delete from user
where email like 'live-e2e-%@example.com'
  or email like 'live-full-%@example.com'
  or email like 'ui-e2e-%@example.com'
  or email like 'ui-invite-%@example.com'
  or email like 'ui-shot-%@example.com'
  or email like 'live-probe-%@example.com'
  or email like 'live-vector-probe-%@example.com';
