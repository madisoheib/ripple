<?php

namespace Ripple\Laravel\Console;

use Illuminate\Console\Command;
use Ripple\Laravel\Platform;

class StartCommand extends Command
{
    protected $signature = 'ripple:start {--config= : Path to a ripple.toml (default: generated from config)}';
    protected $description = 'Run the ripple WebSocket server.';

    public function handle(): int
    {
        $bin = config('ripple.bin');
        if (! is_file($bin)) {
            $this->error("Binary not found at {$bin}. Run: php artisan ripple:install");
            return self::FAILURE;
        }

        $config = $this->option('config');
        if (! $config) {
            $config = storage_path('ripple.toml');
            file_put_contents($config, Platform::toml(config('ripple')));
        }

        $this->info("Starting ripple (config: {$config}) — Ctrl+C to stop.");
        $cmd = escapeshellarg($bin) . ' start --config ' . escapeshellarg($config);
        passthru($cmd, $code);

        return $code === 0 ? self::SUCCESS : self::FAILURE;
    }
}
