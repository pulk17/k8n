// What every Kubernetes kind actually *is*, in the words you would use to
// explain it to someone at a whiteboard.
//
// This file is the reason k8n is not just another YAML generator. Dragging a
// Deployment next to a Service teaches you nothing on its own; the canvas has
// to say why those two things are separate objects in the first place. Every
// surface that shows a kind — the toolbox, the inspector, the node card — reads
// its wording from here, so the explanation is the same wherever you meet it.
//
// Rules for writing an entry:
//   · `summary` has to fit on one line in a 264px toolbox row.
//   · `analogy` is a single concrete image, not a definition.
//   · `gotchas` are mistakes people actually make, not trivia.
//   · `kubectl` is what you would really type, so the canvas stays honest about
//     being a front end for the same API.

export interface Concept {
  /** One line, shown in the toolbox and on hover. */
  summary: string;
  /** A concrete image to hang the idea on. */
  analogy: string;
  /** Two or three sentences on what it does and why it exists. */
  whatItDoes: string;
  /** The single sentence worth remembering. */
  keyIdea: string;
  /** Mistakes people make with this kind. */
  gotchas: string[];
  /** What you would really type to look at one of these. `{name}` is filled in. */
  kubectl: string[];
  /** Upstream documentation. */
  docs: string;
}

const K8S_DOCS = "https://kubernetes.io/docs/concepts";
const RBAC_DOCS = "https://kubernetes.io/docs/reference/access-authn-authz/rbac/";

export const CONCEPTS: Record<string, Concept> = {
  Deployment: {
    summary: "Keeps N identical pods running, and rolls out changes safely",
    analogy: "A thermostat for your app: you set “three replicas”, it keeps three.",
    whatItDoes:
      "A Deployment does not run your container. It creates a ReplicaSet, and the ReplicaSet creates pods. " +
      "When you change the image, the Deployment makes a new ReplicaSet and shifts pods from the old one to the " +
      "new one a few at a time, so the app stays up while it changes.",
    keyIdea: "You declare the end state. Kubernetes works out the steps to get there.",
    gotchas: [
      "Deleting a pod does not get rid of it — the ReplicaSet immediately makes another. Scale to 0, or delete the Deployment.",
      "A stuck rollout still reports Ready, because the old pods are still serving. Check the rollout, not just the replica count.",
      "Pods get new names and new IPs every time. Never point anything at a pod IP; that is what a Service is for.",
    ],
    kubectl: [
      "kubectl get deployment {name} -n {namespace}",
      "kubectl rollout status deployment/{name} -n {namespace}",
      "kubectl rollout undo deployment/{name} -n {namespace}",
    ],
    docs: `${K8S_DOCS}/workloads/controllers/deployment/`,
  },

  StatefulSet: {
    summary: "Like a Deployment, but pods keep their name, disk and order",
    analogy: "Numbered lockers. Locker 0 is always locker 0, and it keeps its contents.",
    whatItDoes:
      "A StatefulSet gives each pod a stable identity — web-0, web-1, web-2 — and each one gets its own " +
      "PersistentVolumeClaim that follows it across restarts. Pods start in order and are removed in reverse.",
    keyIdea: "Use it when a replica is not interchangeable — databases, queues, anything holding data.",
    gotchas: [
      "Deleting the StatefulSet does not delete its volumes. That is deliberate, and it is also how clusters quietly fill up.",
      "It needs a headless Service (clusterIP: None) for the stable DNS names to work at all.",
      "Scaling down leaves the volumes behind, so scaling back up reattaches the old data.",
    ],
    kubectl: [
      "kubectl get statefulset {name} -n {namespace}",
      "kubectl get pvc -n {namespace}",
    ],
    docs: `${K8S_DOCS}/workloads/controllers/statefulset/`,
  },

  DaemonSet: {
    summary: "Runs exactly one copy of a pod on every node",
    analogy: "A smoke alarm in every room — add a room, you get an alarm.",
    whatItDoes:
      "A DaemonSet has no replica count. It puts one pod on each node that matches its selector, and when a new " +
      "node joins the cluster it gets one automatically. Log collectors, metrics agents and network plugins work this way.",
    keyIdea: "The replica count is “however many nodes there are”, decided by the cluster, not by you.",
    gotchas: [
      "Control-plane nodes are usually tainted, so your DaemonSet skips them unless you add a toleration.",
      "It is for per-node work. If your app does not care which node it is on, you want a Deployment.",
    ],
    kubectl: [
      "kubectl get daemonset {name} -n {namespace}",
      "kubectl get pods -o wide -n {namespace}",
    ],
    docs: `${K8S_DOCS}/workloads/controllers/daemonset/`,
  },

  Pod: {
    summary: "One or more containers that share an IP and a lifecycle",
    analogy: "A flat share: separate rooms, one front door and one address.",
    whatItDoes:
      "A pod is the smallest thing Kubernetes will schedule. Containers inside it share a network namespace, so they " +
      "reach each other on localhost, and they can share volumes. They also live and die together.",
    keyIdea: "Almost nobody creates pods directly — a controller creates them for you.",
    gotchas: [
      "A bare pod is not replaced if its node dies. Nothing owns it, so nothing recreates it.",
      "Two containers in one pod cannot both bind the same port; they share the network.",
      "Pods are cattle, not pets. Assume any pod can vanish at any moment.",
    ],
    kubectl: [
      "kubectl describe pod {name} -n {namespace}",
      "kubectl logs {name} -n {namespace} --tail=200",
      "kubectl exec -it {name} -n {namespace} -- sh",
    ],
    docs: `${K8S_DOCS}/workloads/pods/`,
  },

  ReplicaSet: {
    summary: "Keeps a fixed number of identical pods alive",
    analogy: "The part of the thermostat that actually switches the heating on.",
    whatItDoes:
      "A ReplicaSet counts pods matching its selector and creates or deletes pods until the count matches. " +
      "Deployments create ReplicaSets — one per revision — which is how a rollback is just pointing back at the old one.",
    keyIdea: "You rarely write one. Seeing several means you have several Deployment revisions.",
    gotchas: [
      "Editing a ReplicaSet directly gets overwritten by its Deployment on the next reconcile.",
      "Old ReplicaSets with 0 pods are kept on purpose — they are your undo history.",
    ],
    kubectl: ["kubectl get replicaset -n {namespace}"],
    docs: `${K8S_DOCS}/workloads/controllers/replicaset/`,
  },

  Job: {
    summary: "Runs a pod until it finishes successfully, then stops",
    analogy: "A task on a to-do list — it is done when it is done.",
    whatItDoes:
      "A Job runs a pod and watches for it to exit 0. If the container fails, the Job retries up to backoffLimit " +
      "times. Unlike a Deployment, success means stopping, not staying up.",
    keyIdea: "Exit code 0 means finished. Anything else means retry.",
    gotchas: [
      "Completed Jobs and their pods stay around so you can read the logs — set ttlSecondsAfterFinished to clean up.",
      "restartPolicy must be Never or OnFailure. Always is rejected, because a Job that always restarts never completes.",
    ],
    kubectl: [
      "kubectl get job {name} -n {namespace}",
      "kubectl logs job/{name} -n {namespace}",
    ],
    docs: `${K8S_DOCS}/workloads/controllers/job/`,
  },

  CronJob: {
    summary: "Creates a Job on a repeating schedule",
    analogy: "crontab, but it makes a fresh pod each time instead of a process.",
    whatItDoes:
      "A CronJob holds a schedule and a Job template. At each tick it creates a new Job, which creates a pod. " +
      "The schedule uses standard cron syntax and runs in the cluster's timezone unless you say otherwise.",
    keyIdea: "A CronJob makes Jobs. It never runs a container itself.",
    gotchas: [
      "If a run overruns the next tick, concurrencyPolicy decides what happens — the default Allow will happily pile them up.",
      "History defaults to 3 successful and 1 failed Job. Older runs are deleted, logs and all.",
      "A schedule that never fires is usually a timezone assumption, not a syntax error.",
    ],
    kubectl: [
      "kubectl get cronjob {name} -n {namespace}",
      "kubectl create job --from=cronjob/{name} {name}-manual -n {namespace}",
    ],
    docs: `${K8S_DOCS}/workloads/controllers/cron-jobs/`,
  },

  Service: {
    summary: "One stable address and DNS name in front of a set of pods",
    analogy: "A shop's phone number. Staff change; the number does not.",
    whatItDoes:
      "Pods come and go with new IPs each time, so nothing can address them directly. A Service gets a fixed " +
      "cluster IP and a DNS name, and forwards traffic to whichever pods currently match its label selector.",
    keyIdea: "A Service finds pods by labels, not by which Deployment made them.",
    gotchas: [
      "If the selector matches no pod labels, the Service has no endpoints and connections just hang. This is the most common mistake in Kubernetes.",
      "port is what the Service listens on; targetPort is the port on the container. Mixing them up gives you a healthy-looking Service that refuses connections.",
      "type: LoadBalancer needs a cloud provider or MetalLB. On a laptop cluster it sits in Pending forever.",
    ],
    kubectl: [
      "kubectl get endpoints {name} -n {namespace}",
      "kubectl describe service {name} -n {namespace}",
      "kubectl port-forward service/{name} 8080:80 -n {namespace}",
    ],
    docs: `${K8S_DOCS}/services-networking/service/`,
  },

  Ingress: {
    summary: "Routes outside HTTP traffic to Services by host and path",
    analogy: "The receptionist: reads the request, sends it to the right desk.",
    whatItDoes:
      "An Ingress is a set of HTTP routing rules — this hostname and path goes to that Service. It also terminates " +
      "TLS. On its own it is only a document; an ingress controller has to be running to act on it.",
    keyIdea: "Ingress is a rule, not a server. Without a controller, nothing happens.",
    gotchas: [
      "No ingress controller installed means the Ingress is created, reports no address, and silently does nothing.",
      "It only understands HTTP and HTTPS. For TCP or UDP you need a LoadBalancer Service or a Gateway.",
      "The Service it points at must be in the same namespace as the Ingress.",
    ],
    kubectl: [
      "kubectl get ingress {name} -n {namespace}",
      "kubectl describe ingress {name} -n {namespace}",
    ],
    docs: `${K8S_DOCS}/services-networking/ingress/`,
  },

  NetworkPolicy: {
    summary: "Firewall rules for which pods may talk to which pods",
    analogy: "Door badges. Without any, every door in the building is open.",
    whatItDoes:
      "By default every pod can reach every other pod. A NetworkPolicy selects some pods and describes the traffic " +
      "they may receive or send. The moment any policy selects a pod, everything not explicitly allowed is denied.",
    keyIdea: "Policies only ever allow. Selecting a pod at all is what creates the deny.",
    gotchas: [
      "Your CNI plugin has to support NetworkPolicy. Flannel does not, and the policy is accepted and ignored — it looks like it works.",
      "Adding an ingress rule to a pod cuts off every other source immediately. Allow DNS to kube-system or name resolution breaks.",
    ],
    kubectl: [
      "kubectl describe networkpolicy {name} -n {namespace}",
      "kubectl get pods -n {namespace} --show-labels",
    ],
    docs: `${K8S_DOCS}/services-networking/network-policies/`,
  },

  ConfigMap: {
    summary: "Non-secret configuration, kept outside the image",
    analogy: "A settings file you can swap without rebuilding the app.",
    whatItDoes:
      "A ConfigMap is key/value data that pods read as environment variables or as files on a mounted volume. " +
      "It exists so the same image can run in dev and prod with different settings.",
    keyIdea: "Configuration belongs to the environment, not to the image.",
    gotchas: [
      "Values injected as environment variables are read once at start. Changing the ConfigMap does nothing until the pod restarts.",
      "Values mounted as a volume do update in place, after up to a minute — but only if your app re-reads the file.",
      "It is not encrypted and not separately access-controlled. Anything sensitive belongs in a Secret.",
    ],
    kubectl: [
      "kubectl get configmap {name} -n {namespace} -o yaml",
      "kubectl rollout restart deployment -n {namespace}",
    ],
    docs: `${K8S_DOCS}/configuration/configmap/`,
  },

  Secret: {
    summary: "Configuration for passwords, tokens and keys",
    analogy: "The same settings file, kept in a drawer instead of on the desk.",
    whatItDoes:
      "A Secret works exactly like a ConfigMap — env vars or mounted files — but it is stored base64-encoded, kept " +
      "out of most logs, and can be locked down with RBAC separately from other config.",
    keyIdea: "base64 is encoding, not encryption. Anyone who can read the Secret can read the value.",
    gotchas: [
      "Secrets sit unencrypted in etcd unless encryption at rest is turned on.",
      "Anyone who can create a pod in the namespace can mount any Secret in it. RBAC on Secrets is only half the story.",
      "Never commit a Secret manifest to git. Use a sealed secret or an external store.",
    ],
    kubectl: [
      "kubectl get secret {name} -n {namespace}",
      "kubectl describe secret {name} -n {namespace}",
    ],
    docs: `${K8S_DOCS}/configuration/secret/`,
  },

  PersistentVolumeClaim: {
    summary: "A request for disk that outlives the pod using it",
    analogy: "Asking the storeroom for 10GB. You get a shelf; you do not pick which one.",
    whatItDoes:
      "A PVC says how much space you need and how it should be mounted. The cluster matches it to a PersistentVolume, " +
      "or provisions one on the spot if a StorageClass supports it. The pod mounts the claim, not the disk.",
    keyIdea: "You ask for storage by size and access mode; the cluster decides what backs it.",
    gotchas: [
      "A PVC stuck in Pending nearly always means no default StorageClass, or no volume matches the access mode.",
      "ReadWriteOnce means one node, not one pod. Two pods on different nodes cannot both mount it.",
      "Deleting the pod keeps the data. Deleting the PVC is what destroys it — and with reclaimPolicy Delete, the disk goes too.",
    ],
    kubectl: [
      "kubectl describe pvc {name} -n {namespace}",
      "kubectl get storageclass",
    ],
    docs: `${K8S_DOCS}/storage/persistent-volumes/`,
  },

  PersistentVolume: {
    summary: "An actual piece of storage registered with the cluster",
    analogy: "The shelf itself, as opposed to the request for shelf space.",
    whatItDoes:
      "A PV represents real storage — a cloud disk, an NFS export, a path on a node. It is a cluster-wide object with " +
      "no namespace, and it is bound one-to-one to a claim.",
    keyIdea: "PVs are cluster-scoped infrastructure; PVCs are the namespaced request for them.",
    gotchas: [
      "Most clusters provision these automatically. Writing PVs by hand usually means working around a missing StorageClass.",
      "A released PV is not reusable until it is cleaned up — it stays Released, holding the old claim's identity.",
    ],
    kubectl: ["kubectl get pv", "kubectl describe pv {name}"],
    docs: `${K8S_DOCS}/storage/persistent-volumes/`,
  },

  ServiceAccount: {
    summary: "The identity a pod uses when it calls the Kubernetes API",
    analogy: "A staff badge — it says who you are, not what you may do.",
    whatItDoes:
      "Every pod runs as a ServiceAccount, defaulting to one called default. A token is mounted into the pod so code " +
      "inside can authenticate to the API server. On its own it grants nothing at all.",
    keyIdea: "Identity and permission are separate. A binding is what turns one into the other.",
    gotchas: [
      "The default account in each namespace is used automatically. Give it permissions and every pod in that namespace has them.",
      "Creating the account does nothing until a RoleBinding or ClusterRoleBinding references it.",
    ],
    kubectl: [
      "kubectl get serviceaccount {name} -n {namespace}",
      "kubectl auth can-i --list --as=system:serviceaccount:{namespace}:{name}",
    ],
    docs: "https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/",
  },

  Role: {
    summary: "A list of allowed verbs on resources, inside one namespace",
    analogy: "A job description: may read pods, may not delete them.",
    whatItDoes:
      "A Role is a set of rules — these API groups, these resources, these verbs. It is purely a list of permissions " +
      "and applies only within its own namespace.",
    keyIdea: "A Role grants nothing until a RoleBinding attaches it to someone.",
    gotchas: [
      "RBAC is allow-only. There is no deny rule, so you cannot subtract a permission — only grant less.",
      "Roles cannot cover cluster-scoped things like nodes or PVs. That needs a ClusterRole.",
    ],
    kubectl: ["kubectl describe role {name} -n {namespace}"],
    docs: RBAC_DOCS,
  },

  ClusterRole: {
    summary: "The same as a Role, but cluster-wide",
    analogy: "A job description valid in every branch, not just your office.",
    whatItDoes:
      "A ClusterRole covers cluster-scoped resources and can be reused across namespaces. Bound with a " +
      "ClusterRoleBinding it applies everywhere; bound with a RoleBinding it applies in that one namespace only.",
    keyIdea: "The binding, not the role, decides how far the permission reaches.",
    gotchas: [
      "Binding cluster-admin is almost never what you meant. It is full control of everything.",
      "The built-in view, edit and admin ClusterRoles cover most cases — check before writing your own.",
    ],
    kubectl: ["kubectl describe clusterrole {name}"],
    docs: RBAC_DOCS,
  },

  RoleBinding: {
    summary: "Grants a Role to a user or ServiceAccount in one namespace",
    analogy: "Actually handing someone the job description and the keys.",
    whatItDoes:
      "A RoleBinding joins a subject — a ServiceAccount, user or group — to a Role or ClusterRole, taking effect " +
      "inside its own namespace.",
    keyIdea: "This is the object that makes permissions real. Without it, roles are inert.",
    gotchas: [
      "The subject's namespace must be spelled out, or a ServiceAccount from another namespace will not be found.",
      "roleRef cannot be edited after creation — delete and recreate the binding to point it somewhere else.",
    ],
    kubectl: ["kubectl describe rolebinding {name} -n {namespace}"],
    docs: RBAC_DOCS,
  },

  ClusterRoleBinding: {
    summary: "Grants a ClusterRole across the whole cluster",
    analogy: "A master key. Worth being careful with.",
    whatItDoes:
      "A ClusterRoleBinding attaches a ClusterRole to a subject with no namespace limit — the permission applies to " +
      "every namespace and to cluster-scoped resources.",
    keyIdea: "There is no way to narrow this later. The scope is the whole cluster.",
    gotchas: [
      "If you only need one namespace, use a RoleBinding pointing at the same ClusterRole.",
      "Binding a ServiceAccount to cluster-admin makes anything that can read that token cluster-admin too.",
    ],
    kubectl: ["kubectl describe clusterrolebinding {name}"],
    docs: RBAC_DOCS,
  },

  HorizontalPodAutoscaler: {
    summary: "Changes replica count automatically based on load",
    analogy: "Opening more checkouts when the queue gets long.",
    whatItDoes:
      "An HPA watches a metric — usually CPU — against a target and adjusts the replica count of a Deployment or " +
      "StatefulSet to hold near that target, within the min and max you set.",
    keyIdea: "It scales the number of pods. It does not make any single pod bigger.",
    gotchas: [
      "It needs metrics-server. Without it the HPA reports unknown metrics and never scales.",
      "CPU targets are a percentage of the container's request. With no resources.requests set there is nothing to take a percentage of, and the HPA does nothing.",
      "Do not also set replicas on the workload — the two fight, and every apply resets the count.",
    ],
    kubectl: [
      "kubectl describe hpa {name} -n {namespace}",
      "kubectl top pods -n {namespace}",
    ],
    docs: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/",
  },

  Namespace: {
    summary: "A named partition for grouping and isolating resources",
    analogy: "Folders. Two files can share a name in different folders.",
    whatItDoes:
      "Namespaces scope names, and give you a boundary to hang quotas, RBAC and network policy on. Most everyday " +
      "objects live in one; nodes, PVs and ClusterRoles do not.",
    keyIdea: "A namespace is an organisational boundary, not a security one — not by itself.",
    gotchas: [
      "Deleting a namespace deletes everything in it, with no confirmation and no undo.",
      "Cross-namespace DNS needs the full name: service.namespace.svc.cluster.local.",
    ],
    kubectl: ["kubectl get all -n {name}", "kubectl describe namespace {name}"],
    docs: `${K8S_DOCS}/overview/working-with-objects/namespaces/`,
  },

  HelmRelease: {
    summary: "An installed Helm chart — many resources managed as one unit",
    analogy: "apt install for Kubernetes: one command, a whole application.",
    whatItDoes:
      "A chart is a parameterised bundle of manifests. Installing it creates a release, which Helm tracks so it can " +
      "be upgraded or rolled back as a single thing. Your values override the chart's defaults.",
    keyIdea: "Helm owns everything it installs. Edit those objects by hand and the next upgrade overwrites you.",
    gotchas: [
      "Applying a chart's YAML directly instead of installing it creates the resources without Helm knowing — you then have two owners for one object.",
      "helm upgrade only sends what changed against the release, so a resource someone edited by hand may not be corrected.",
      "Pin the chart version. Without it, the same install gives you different software next month.",
    ],
    kubectl: [
      "helm status {name} -n {namespace}",
      "helm get values {name} -n {namespace}",
      "helm history {name} -n {namespace}",
    ],
    docs: "https://helm.sh/docs/intro/using_helm/",
  },
};

/** The concept for a kind, or undefined for CRDs k8n has no wording for. */
export const conceptFor = (kind: string): Concept | undefined => CONCEPTS[kind];

/**
 * Fills the placeholders in a kubectl line. Namespace falls back to `default`
 * because that is what kubectl itself would assume, so the command shown is
 * always one you could paste as-is.
 */
export function kubectlFor(command: string, name: string, namespace?: string): string {
  return command
    .replaceAll("{name}", name || "NAME")
    .replaceAll("{namespace}", namespace || "default");
}

/**
 * Why an edge of this type exists, in a sentence or two.
 *
 * Keyed by the same connection types as CONNECTION_TYPES, so selecting a wire
 * on the canvas can explain the relationship instead of only highlighting it.
 */
export const CONNECTION_CONCEPTS: Record<string, { title: string; explanation: string }> = {
  network: {
    title: "Traffic — Service to pods",
    explanation:
      "The Service copies the workload's labels into its selector. Anything that reaches the Service is forwarded to " +
      "whichever pods currently carry those labels, so pods can be replaced without the caller noticing.",
  },
  routing: {
    title: "HTTP routing",
    explanation:
      "The Ingress matches a hostname and path and forwards to this Service's port. The Service still does the pod " +
      "selection; the Ingress only decides which Service gets the request.",
  },
  config: {
    title: "Configuration",
    explanation:
      "The workload reads this ConfigMap or Secret, either as environment variables or as files on a mounted volume. " +
      "Env vars are fixed at pod start; mounted files can change while the pod runs.",
  },
  storage: {
    title: "Storage",
    explanation:
      "The workload mounts this claim at a path inside its containers. The data belongs to the claim, so it survives " +
      "the pod being deleted, rescheduled or rolled out.",
  },
  scaling: {
    title: "Autoscaling",
    explanation:
      "The autoscaler owns this workload's replica count and adjusts it to hold the target metric. Set replicas on " +
      "the workload as well and the two will fight.",
  },
  security: {
    title: "Identity and policy",
    explanation:
      "This attaches an identity or a restriction to the workload — which ServiceAccount its pods run as, or which " +
      "traffic a NetworkPolicy will let through to them.",
  },
  helm: {
    title: "Managed by Helm",
    explanation:
      "This resource comes from a Helm chart, so Helm owns it. Change it here and the next helm upgrade puts it back.",
  },
  ownership: {
    title: "Owned by",
    explanation:
      "A controller created this resource and keeps it in step. Delete the owner and Kubernetes garbage-collects " +
      "everything it owns.",
  },
};
