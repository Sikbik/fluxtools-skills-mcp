# Flux App Spec v8 (Quick Template)

A minimal single-component v8 spec:

```json
{
  "version": 8,
  "name": "my-app",
  "description": "Short description",
  "owner": "t1YourFluxAddress",
  "compose": [
    {
      "name": "web",
      "description": "web",
      "repotag": "nginx:alpine",
      "ports": [31111],
      "domains": [""],
      "environmentParameters": ["NODE_ENV=production"],
      "commands": [],
      "containerPorts": [80],
      "containerData": "/data",
      "cpu": 1,
      "ram": 2000,
      "hdd": 10,
      "repoauth": ""
    }
  ],
  "instances": 3,
  "contacts": [],
  "geolocation": [],
  "expire": 22000,
  "nodes": [],
  "staticip": false,
  "enterprise": ""
}
```

In this repo, prefer generating specs via the MCP tool `flux_generate_app_spec_v8`, then validating with the verify endpoints.
