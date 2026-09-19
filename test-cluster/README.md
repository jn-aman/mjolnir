# A cluster worth testing against

The demo cluster proves the UI renders. It does not prove the UI is useful,
because nothing in it is shaped like production: no traffic, no lag, no
crashing sidecar, no bucket with a 7 MB log file in it. This is the other
fixture, and it runs on OrbStack, kind or any cluster you do not mind filling.

```bash
kubectl apply -f 00-ns.yaml
kubectl apply -f 10-data.yaml          # postgres, redis, minio, rustfs
kubectl apply -f 20-kafka.yaml         # kafka in kraft mode
kubectl -n shop apply -f https://raw.githubusercontent.com/GoogleCloudPlatform/microservices-demo/main/release/kubernetes-manifests.yaml
kubectl apply -f 30-extras.yaml        # ingress, hpa, pdb, netpol, quota, limits, cronjob
kubectl apply -f 40-seed.yaml          # every file type, into both object stores
kubectl apply -f 50-kafka-traffic.yaml # a producer, and a consumer that falls behind
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

## What it gives you

**Online Boutique** in `shop`: twelve real microservices in Go, C#, Node, Python
and Java, talking gRPC to each other, with a load generator so the traffic,
the logs and the CPU are real rather than idle.

**Data services** in `data`: Postgres as a StatefulSet with a volume claim
template, Redis, Kafka in KRaft mode with four topics, and two S3
implementations, MinIO and RustFS, because a bucket browser that only works
against MinIO is a MinIO browser.

**Consumer lag that is real.** The producer writes every second and the
consumer reads five messages every twenty-five, so the `fulfilment` group
falls behind on purpose and keeps falling behind.

**Every file type**, seeded into both stores: JSON, YAML, CSV, XML, HTML, CSS,
Markdown, a Dockerfile, TypeScript, Python, Go, SQL, a log file, a dotenv, a
real PNG, GIF and SVG, a real PDF, a WAV, an MP4, a ZIP, a raw binary for the
hex dump, a 7 MB text file for ranged reads, and a path nested eight folders
deep.

**The awkward objects**, so the detail panes have something to say: an Ingress
with two hosts and three paths, an HPA against the frontend, a
PodDisruptionBudget that will block a drain, a NetworkPolicy that names two
peers, a ResourceQuota, a LimitRange, and a CronJob on a five minute schedule
with history to show.

## Tearing it down

```bash
kubectl delete ns shop data
```
