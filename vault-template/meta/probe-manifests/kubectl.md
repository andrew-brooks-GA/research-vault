# Probe manifest: kubectl

```yaml
tool: kubectl
version_command: kubectl version --client
probes:
  - name: create-help
    command: kubectl create --help
    ground_truth_for: subcommands and flags of `kubectl create`
  - name: explain-deployment-spec
    command: kubectl explain deployment.spec
    ground_truth_for: fields of the Deployment spec served by the connected cluster
  - name: api-resources
    command: kubectl api-resources
    ground_truth_for: resource kinds, short names, and API groups the cluster serves
```
