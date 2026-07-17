module.exports = {
  apps: [
    {
      name: "agent-quest",
      cwd: "/var/www/agent-quest/current",
      script: "npm",
      args: "start -- -p 3304",
      env: { NODE_ENV: "production" },
      watch: false,
      max_memory_restart: "500M",
    },
  ],
};
