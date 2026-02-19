SELECT cron.schedule(
    'purge-route-cache',
    '0 * * * *',
    $sql$DELETE FROM route_cache WHERE expires_at < NOW()$sql$
);