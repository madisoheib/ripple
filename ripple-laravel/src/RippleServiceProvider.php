<?php

namespace Ripple\Laravel;

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\ServiceProvider;
use Pusher\Pusher;
use Ripple\Laravel\Console\InstallCommand;
use Ripple\Laravel\Console\StartCommand;

class RippleServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/ripple.php', 'ripple');

        // Register the broadcast connection so users only set
        // BROADCAST_CONNECTION=ripple — no editing of config/broadcasting.php.
        $config = $this->app['config'];
        $config->set('broadcasting.connections.ripple', array_merge(
            ['driver' => 'ripple'],
            $config->get('broadcasting.connections.ripple', []),
        ));
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../config/ripple.php' => config_path('ripple.php'),
        ], 'ripple-config');

        if ($this->app->runningInConsole()) {
            $this->commands([InstallCommand::class, StartCommand::class]);
        }

        // The server speaks Pusher, so we build on Laravel's PusherBroadcaster —
        // RippleBroadcaster only normalizes the pusher lib's trigger()
        // signature so Laravel 6 through 13 all work with one package version.
        Broadcast::extend('ripple', function ($app, $config) {
            $c = config('ripple');
            $pusher = new Pusher($c['key'], $c['secret'], $c['app_id'], [
                'host'    => $c['host'],
                'port'    => (int) $c['port'],
                'scheme'  => $c['scheme'],
                'useTLS'  => $c['scheme'] === 'https',
                'encrypted' => $c['scheme'] === 'https',
            ]);

            return new RippleBroadcaster($pusher);
        });
    }
}
