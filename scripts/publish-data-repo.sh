#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -lt 4 ]]; then
  echo "Usage: publish-data-repo.sh <repository-dir> <branch> <message> <path> [<path> ...]" >&2
  exit 2
fi

repository_dir="$1"
target_branch="$2"
commit_message="$3"
shift 3
publish_paths=("$@")

max_attempts="${PUBLISH_MAX_ATTEMPTS:-5}"
retry_delay_seconds="${PUBLISH_RETRY_DELAY_SECONDS:-2}"

if ! [[ "${max_attempts}" =~ ^[1-9][0-9]*$ ]]; then
  echo "PUBLISH_MAX_ATTEMPTS must be a positive integer." >&2
  exit 2
fi

if ! [[ "${retry_delay_seconds}" =~ ^[0-9]+$ ]]; then
  echo "PUBLISH_RETRY_DELAY_SECONDS must be a non-negative integer." >&2
  exit 2
fi

cd "${repository_dir}"

git config user.name github-actions
git config user.email github-actions@users.noreply.github.com
git add -A -- "${publish_paths[@]}"

if git diff --cached --quiet; then
  echo "No selected data changes to publish."
  exit 0
fi

git commit -m "${commit_message}"

for attempt in $(seq 1 "${max_attempts}"); do
  echo "Publishing data commit (attempt ${attempt}/${max_attempts})."

  if ! git fetch origin "${target_branch}"; then
    echo "Could not fetch origin/${target_branch}." >&2
  elif ! git rebase "origin/${target_branch}"; then
    echo "Could not rebase the generated data commit." >&2
    git rebase --abort || true
    exit 1
  elif git push origin "HEAD:${target_branch}"; then
    echo "Published data commit to origin/${target_branch}."
    exit 0
  else
    echo "Push was rejected or interrupted; refreshing the remote branch." >&2
  fi

  if [[ "${attempt}" -lt "${max_attempts}" ]]; then
    sleep "$((retry_delay_seconds * attempt))"
  fi
done

echo "Could not publish data after ${max_attempts} attempts." >&2
exit 1
